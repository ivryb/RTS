import * as THREE from "three";
import { BUILDING_CATALOG } from "./buildingCatalog";
import { healthMeter, hudIcon } from "./hudIcons";
import {
  UNIT_ACTIONS,
  type ActionTargetMode,
  type UnitActionId,
} from "./unitActions";
import type { UnitSystem } from "./unitSystem";
import { POSITION_SCALE, type BuildingKind } from "./sim/units";
import { TRAINING_SECONDS } from "./sim/production";
import { UNIT_CATALOG, type UnitKind } from "./unitCatalog";

type TargetMode = ActionTargetMode | "attack-any" | "rally";
type AttackTargetMode = Exclude<TargetMode, "move" | "rally">;
type AttackCommander = Pick<UnitSystem, "attackSelected" | "attackGroundSelected">;

export function resolveAttackTarget(
  system: AttackCommander,
  mode: AttackTargetMode,
  buildingId?: string,
  point?: { x: number; z: number },
) {
  let issued = false;
  if ((mode === "attack" || mode === "attack-any") && buildingId) {
    issued = system.attackSelected(buildingId) || issued;
  }
  if ((mode === "attack-ground" || mode === "attack-any") && point) {
    issued = system.attackGroundSelected(point.x, point.z) || issued;
  }
  return issued;
}

export const formatAttackDamage = (damage: number) => `Attack ${damage}`;

export const selectableEntityId = (picked?: THREE.Object3D) => {
  let object = picked;
  while (object && !object.userData.buildingId && !object.userData.unitId && !object.userData.resourceId) {
    object = object.parent ?? undefined;
  }
  const candidate: unknown = object?.userData.buildingId ?? object?.userData.unitId ?? object?.userData.resourceId;
  return typeof candidate === "string" ? candidate : undefined;
};

/** Visible geometry wins over generous click helpers belonging to nearby entities. */
export const pickSurface = (hits: readonly THREE.Intersection[]) => {
  let fallback: THREE.Intersection | undefined;
  for (const hit of hits) {
    let object: THREE.Object3D | null = hit.object;
    let hidden = false;
    while (object) {
      if (!object.visible || object.userData.selectionOverlay) hidden = true;
      object = object.parent;
    }
    if (hidden) continue;
    if (hit.object.userData.selectionProxy) {
      fallback ??= hit;
      continue;
    }
    // A scaffold is drawn by one mesh shared by every site, so each site answers its own clicks.
    if (hit.object.userData.pickSurface) return hit;
    if (!(hit.object instanceof THREE.Mesh)) continue;
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face?.materialIndex ?? 0]
      : hit.object.material;
    if (material?.visible && material.opacity > 0) return hit;
  }
  return fallback;
};

export class UnitInput {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly worldPosition = new THREE.Vector3();
  private readonly roster: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actionGrid: HTMLElement;
  private readonly buttons: Record<UnitActionId, HTMLButtonElement>;
  private readonly buildKindButtons: Record<BuildingKind, HTMLButtonElement>;
  private readonly trainButtons: Record<UnitKind, HTMLButtonElement>;
  private readonly rallyButton: HTMLButtonElement;
  private readonly productionQueue: HTMLElement;
  private world?: THREE.Group;
  private pointerId?: number;
  private targetMode?: TargetMode;
  private placementKind?: BuildingKind;
  private buildMenuOpen = false;
  private buildPending = false;
  private pointerInside = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  private rosterSignature = "";
  private renderedHudState = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly panel: HTMLElement,
    private readonly selectionBox: HTMLElement,
  ) {
    this.roster = panel.querySelector("#unit-roster")!;
    this.status = panel.querySelector("#unit-status")!;
    this.actionGrid = panel.querySelector(".action-grid")!;
    this.productionQueue = panel.querySelector("#production-queue")!;
    this.buttons = {
      move: panel.querySelector('[data-action="move"]')!,
      stop: panel.querySelector('[data-action="stop"]')!,
      attack: panel.querySelector('[data-action="attack"]')!,
      "attack-ground": panel.querySelector('[data-action="attack-ground"]')!,
      build: panel.querySelector('[data-action="build"]')!,
    };
    this.buildKindButtons = {
      turret: panel.querySelector('[data-build-kind="turret"]')!,
      "command-center": panel.querySelector('[data-build-kind="command-center"]')!,
    };
    this.trainButtons = {
      "scout-drone": panel.querySelector('[data-train-kind="scout-drone"]')!,
      ghostrunner: panel.querySelector('[data-train-kind="ghostrunner"]')!,
      hornet: panel.querySelector('[data-train-kind="hornet"]')!,
      behemoth: panel.querySelector('[data-train-kind="behemoth"]')!,
    };
    this.rallyButton = panel.querySelector("[data-set-rally]")!;
    this.rallyButton.prepend(hudIcon("rally"));
    for (let index = 0; index < 12; index++) {
      const slot = document.createElement("span");
      slot.className = "action-slot";
      slot.setAttribute("aria-hidden", "true");
      slot.style.gridArea = `${Math.floor(index / 4) + 1} / ${index % 4 + 1}`;
      this.actionGrid.prepend(slot);
    }
    for (const [id, action] of Object.entries(UNIT_ACTIONS) as [UnitActionId, typeof UNIT_ACTIONS[UnitActionId]][]) {
      this.buttons[id].prepend(hudIcon(id));
      this.buttons[id].title = `${this.buttons[id].querySelector("span")?.textContent} · ${action.hotkey.replace("Key", "")}`;
      this.buttons[id].addEventListener("click", () => {
        if (id === "stop") this.stopSelected();
        else if (id === "build") this.toggleBuildMenu();
        else this.setTargetMode(action.target);
      });
    }
    for (const [kind, button] of Object.entries(this.buildKindButtons) as [
      BuildingKind,
      HTMLButtonElement,
    ][]) {
      const portrait = document.createElement("img");
      portrait.src = BUILDING_CATALOG[kind].portrait;
      portrait.alt = "";
      portrait.className = "command-portrait";
      button.prepend(portrait);
      button.addEventListener("click", () => this.setPlacementKind(kind));
    }
    for (const [kind, button] of Object.entries(this.trainButtons) as [
      UnitKind,
      HTMLButtonElement,
    ][]) {
      const portrait = document.createElement("img");
      portrait.src = UNIT_CATALOG[kind].portrait;
      portrait.alt = "";
      portrait.className = "command-portrait";
      button.prepend(portrait);
      button.title = `Train ${UNIT_CATALOG[kind].name} · ${TRAINING_SECONDS[kind]} seconds`;
      const duration = button.querySelector("small");
      if (duration) duration.textContent = `${TRAINING_SECONDS[kind]}s`;
      button.addEventListener("click", () => {
        this.unitSystem()?.trainSelected(kind);
        this.update();
      });
    }
    this.rallyButton.addEventListener("click", () => this.setTargetMode("rally"));
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerenter", this.onPointerEnter);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.cancelSelection);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  setWorld(world: THREE.Group) {
    this.unitSystem()?.select();
    this.world = world;
    this.cancelBuild();
    this.setTargetMode();
    this.panel.hidden = true;
    this.rosterSignature = "";
    this.renderedHudState = "";
  }

  update() {
    const system = this.unitSystem();
    const hudState = [
      system?.hudRevision ?? 0,
      this.targetMode ?? "",
      this.placementKind ?? "",
      Number(this.buildMenuOpen),
      Number(this.buildPending),
      system?.matchResult?.resolvedTick ?? "",
    ].join(":");
    if (hudState === this.renderedHudState) return;
    this.renderedHudState = hudState;
    if (system?.matchResult) {
      this.cancelBuild();
      this.setTargetMode();
      this.cancelSelection();
      this.panel.hidden = true;
      return;
    }
    const units = system?.selectedUnits() ?? [];
    const groups = system?.selectedGroups() ?? [];
    const commandable = system?.selectedCommandableUnits() ?? [];
    const buildings = system?.selectedBuildings() ?? [];
    const deposits = system?.selectedDeposits() ?? [];
    this.panel.hidden = units.length === 0 && buildings.length === 0 && deposits.length === 0;
    if (!units.length && !buildings.length && !deposits.length) return;

    const signature = JSON.stringify([...groups.map((group) => [
      group.kind,
      group.count,
      group.health,
      group.maxHealth,
      group.speed,
      group.attackDamage,
      group.attackMinRange,
      group.attackRange,
      group.cargoTitanium,
      group.cargoCapacity,
    ]), ...buildings.map((building) => [
      building.id,
      building.kind,
      building.friendly,
      building.lifecycle,
      building.constructionProgress,
      building.builderId,
      building.health,
      building.maxHealth,
      building.productionQueue,
      building.rallyPoint,
    ]), ...deposits.map(deposit => [deposit.id, deposit.amount])]);
    if (signature !== this.rosterSignature) {
      const unitCards = groups.map((group) => {
        const card = document.createElement("article");
        card.className = "unit-card";
        const portrait = document.createElement("div");
        portrait.className = "unit-portrait";
        const image = document.createElement("img");
        image.src = group.portrait;
        image.alt = group.name;
        portrait.append(image);
        if (group.count > 1) {
          const count = document.createElement("strong");
          count.className = "unit-count";
          count.textContent = `×${group.count}`;
          portrait.append(count);
        }
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = group.name;
        const health = document.createElement("span");
        health.textContent = `Health ${group.health} / ${group.maxHealth}`;
        const speed = document.createElement("span");
        speed.textContent = `Speed ${group.speed.toFixed(2)}`;
        details.append(name, health, healthMeter(group.health, group.maxHealth), speed);
        if (group.cargoCapacity) {
          const cargo = document.createElement("span");
          cargo.className = "cargo-count";
          cargo.textContent = `Titanium carried ${group.cargoTitanium} / ${group.cargoCapacity}`;
          details.append(cargo);
        }
        if (group.attackDamage) {
          const attackDamage = document.createElement("span");
          attackDamage.textContent = formatAttackDamage(group.attackDamage);
          details.append(attackDamage);
        }
        if (group.attackRange) {
          const formatRange = (value: number) => Number.isInteger(value)
            ? String(value)
            : value.toFixed(1);
          const attackRange = document.createElement("span");
          attackRange.textContent = `Attack range ${group.attackMinRange
            ? `${formatRange(group.attackMinRange)}–`
            : ""}${formatRange(group.attackRange)}`;
          details.append(attackRange);
        }
        card.append(portrait, details);
        return card;
      });
      const buildingCards = buildings.map((building) => {
        const card = document.createElement("article");
        card.className = "unit-card building-card";
        const emblem = document.createElement("div");
        emblem.className = "unit-portrait";
        const image = document.createElement("img");
        image.src = BUILDING_CATALOG[building.kind].portrait;
        image.alt = building.name;
        emblem.append(image);
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = building.name;
        const health = document.createElement("span");
        health.textContent = `Health ${building.health} / ${building.maxHealth}`;
        const allegiance = document.createElement("span");
        allegiance.textContent = building.friendly ? "Friendly building" : "Enemy building";
        details.append(name, health, healthMeter(building.health, building.maxHealth));
        if (!building.friendly) details.append(allegiance);
        if (building.lifecycle === "active" && building.weapon) {
          const attackDamage = document.createElement("span");
          attackDamage.textContent = formatAttackDamage(building.weapon.damage);
          details.append(attackDamage);
          const attackRange = document.createElement("span");
          attackRange.textContent = `Attack range ${building.weapon.range / POSITION_SCALE}`;
          details.append(attackRange);
        }
        if (building.lifecycle === "constructing") {
          const progress = document.createElement("span");
          progress.textContent = `Construction ${Math.round(building.constructionProgress * 100)}% · ${
            building.builderId ? "working" : "paused"
          }`;
          details.append(progress);
        }
        card.append(emblem, details);
        return card;
      });
      const depositCards = deposits.map(deposit => {
        const card = document.createElement("article");
        card.className = "unit-card resource-card";
        const emblem = document.createElement("div");
        emblem.className = "resource-emblem";
        emblem.textContent = "Ti";
        emblem.setAttribute("aria-hidden", "true");
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = "Titanium deposit";
        const amount = document.createElement("span");
        amount.textContent = `${deposit.amount.toLocaleString()} remaining`;
        const hint = document.createElement("span");
        hint.textContent = deposit.amount > 0 ? "Scout Drones carry ore to a Command Center" : "Deposit exhausted";
        details.append(name, amount, hint);
        card.append(emblem, details);
        return card;
      });
      this.roster.replaceChildren(...unitCards, ...buildingCards, ...depositCards);
      this.rosterSignature = signature;
    }

    const attacks = new Set(commandable.map((unit) => UNIT_CATALOG[unit.kind].attack));
    const commandCenter = system?.selectedCommandCenter();
    if (this.targetMode && (this.targetMode === "rally" ? !commandCenter : !commandable.length)) {
      this.setTargetMode();
    }
    this.buttons.attack.hidden = !attacks.has("direct");
    this.buttons["attack-ground"].hidden = !attacks.has("ground");
    this.buttons.move.hidden = commandable.length === 0;
    this.buttons.stop.hidden = commandable.length === 0;
    const hasScout = system?.canSelectedBuild() ?? false;
    if (!hasScout && (this.placementKind || this.buildMenuOpen)) this.cancelBuild();
    this.buttons.build.hidden = !hasScout;
    this.buttons.build.setAttribute("aria-pressed", String(this.buildMenuOpen));
    for (const button of Object.values(this.buildKindButtons)) {
      button.hidden = !hasScout || !this.buildMenuOpen;
    }
    for (const [kind, button] of Object.entries(this.trainButtons) as [
      UnitKind,
      HTMLButtonElement,
    ][]) {
      button.hidden = !commandCenter;
      button.disabled = !system?.canTrainSelected(kind);
    }
    this.rallyButton.hidden = !commandCenter;
    this.rallyButton.setAttribute("aria-pressed", String(this.targetMode === "rally"));
    this.productionQueue.hidden = !commandCenter?.productionQueue?.length;
    if (commandCenter) {
      const queue = commandCenter.productionQueue ?? [];
      const slots = queue.map((item, index) => {
        const slot = document.createElement("button");
        slot.className = "production-slot";
        const progress = Math.round(item.progressTicks / item.totalTicks * 100);
        slot.style.setProperty("--progress", `${progress}%`);
        const waitingForExit = index === 0 && item.progressTicks === item.totalTicks;
        const image = document.createElement("img");
        image.src = UNIT_CATALOG[item.kind].portrait;
        image.alt = "";
        const label = document.createElement("span");
        label.textContent = waitingForExit ? "Exit" : index === 0 ? `${progress}%` : String(index + 1);
        slot.append(image, label);
        slot.setAttribute("aria-label", `Cancel ${UNIT_CATALOG[item.kind].name}`);
        slot.title = `${UNIT_CATALOG[item.kind].name} · ${waitingForExit ? "Waiting for exit" : `${progress}%`} · Click to cancel`;
        slot.addEventListener("click", () => {
          system?.cancelTrainingSelected(item.id);
          this.update();
        });
        return slot;
      });
      this.productionQueue.replaceChildren(...slots);
    } else {
      this.productionQueue.replaceChildren();
    }
    this.actionGrid.hidden = !commandable.length && !commandCenter;
    const attacking = units.filter((unit) => unit.attacking).length;
    const moving = units.filter((unit) => unit.moving).length;
    const constructing = units.filter((unit) => unit.order === "build" && !unit.moving).length;
    const harvestActivities: [number, string][] = [
      [units.filter(unit => unit.harvest?.phase === "extracting").length, "mining"],
      [units.filter(unit => unit.harvest?.phase === "to-dropoff").length, "returning titanium"],
      [units.filter(unit => unit.harvest?.phase === "to-deposit").length, "approaching ore"],
      [units.filter(unit => unit.harvest?.phase === "waiting-dropoff").length, "awaiting a reachable Command Center"],
      [units.filter(unit => unit.harvest?.phase === "waiting-deposit").length, "waiting for access to ore"],
    ];
    const harvestStatus = harvestActivities.filter(([count]) => count > 0)
      .map(([count, activity]) => `${count} ${activity}`).join(" · ");
    this.status.textContent = this.buildPending
      ? "Submitting construction order"
      : this.placementKind
      ? `Place ${this.placementKind === "turret" ? "Turret" : "Command Center"}`
      : this.targetMode
      ? this.targetMode === "move"
        ? "Choose a destination"
        : this.targetMode === "rally"
          ? "Choose a terrain rally point"
          : "Choose a target"
      : units.length && !commandable.length
        ? "Enemy units"
      : attacking
        ? `${attacking} attacking`
        : harvestStatus
          ? harvestStatus
        : moving
          ? `${moving} moving`
          : constructing
            ? `${constructing} constructing`
          : "";
    // Status changes must not resize the selection panel when orders start or finish.
    this.status.hidden = false;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, #minimap")) return;
    if (this.matchResolved()) return;
    if (event.code === "Escape" && this.targetMode) {
      this.setTargetMode();
      return;
    }
    if (event.code === "Escape" && (this.placementKind || this.buildMenuOpen)) {
      this.cancelBuild();
      return;
    }
    const system = this.unitSystem();
    if (!system?.selectedCommandableUnits().length) return;
    const unitAction = Object.values(UNIT_ACTIONS)
      .some((action) => action.hotkey === event.code);
    const buildChoice = this.buildMenuOpen && (event.code === "KeyT" || event.code === "KeyC");
    if (!unitAction && !buildChoice) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === UNIT_ACTIONS.stop.hotkey) this.stopSelected();
    if (event.code === UNIT_ACTIONS.move.hotkey) this.setTargetMode("move");
    if (event.code === UNIT_ACTIONS.build.hotkey
      && system.canSelectedBuild()) {
      this.toggleBuildMenu();
    }
    if (this.buildMenuOpen && event.code === "KeyT") this.setPlacementKind("turret");
    if (this.buildMenuOpen && event.code === "KeyC") this.setPlacementKind("command-center");
    if (event.code === UNIT_ACTIONS.attack.hotkey) {
      const attacks = new Set(system.selectedCommandableUnits().map((unit) => UNIT_CATALOG[unit.kind].attack));
      if (attacks.has("direct") && attacks.has("ground")) this.setTargetMode("attack-any");
      else if (attacks.has("direct")) this.setTargetMode("attack");
      else if (attacks.has("ground")) this.setTargetMode("attack-ground");
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    if (this.matchResolved()) return;
    this.rememberPointer(event);
    if (event.button !== 0 || this.targetMode || this.placementKind) return;
    this.pointerId = event.pointerId;
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.dragged = false;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerEnter = (event: PointerEvent) => {
    if (this.matchResolved()) return;
    this.rememberPointer(event);
    this.showAttackGroundPreview();
    this.showConstructionPreview();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.matchResolved()) return;
    this.rememberPointer(event);
    if (this.targetMode === "attack-ground" || this.targetMode === "attack-any") {
      this.showAttackGroundPreview();
      return;
    }
    if (this.placementKind) {
      this.showConstructionPreview();
      return;
    }
    if (event.pointerId !== this.pointerId) return;
    this.dragged ||= Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 5;
    if (this.dragged) this.showSelectionBox(event.clientX, event.clientY);
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.unitSystem()?.hideAttackGroundPreview();
    this.unitSystem()?.hideConstructionPreview();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.matchResolved()) {
      this.cancelSelection();
      return;
    }
    if (event.button !== 0) return;
    if (this.targetMode) {
      this.issueTarget(event.clientX, event.clientY);
      return;
    }
    if (this.placementKind) {
      this.issueConstruction(event.clientX, event.clientY);
      return;
    }
    if (event.pointerId !== this.pointerId) return;
    const system = this.unitSystem();
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.pointerId = undefined;
    this.selectionBox.hidden = true;
    if (this.dragged) {
      const ids = system ? this.unitsInBox(system, event.clientX, event.clientY) : [];
      system?.select(ids, event.shiftKey ? "add" : "replace");
      this.update();
      return;
    }

    const hit = system && this.pick(system.selectables, event.clientX, event.clientY);
    const id = selectableEntityId(hit?.object);
    system?.select(id ? [id] : [], event.shiftKey ? "toggle" : "replace");
    this.update();
  };

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (this.matchResolved()) return;
    this.cancelBuild();
    this.setTargetMode();
    const system = this.unitSystem();
    const terrain = this.world?.userData.terrain as THREE.Object3D | undefined;
    if (!system?.selectedCommandableUnits().length || !terrain) return;
    const selectable = this.pick(system.selectables, event.clientX, event.clientY);
    const selectableId = selectableEntityId(selectable?.object);
    if (selectableId && system.resumeConstructionSelected(selectableId)) {
      this.update();
      return;
    }
    if (selectableId && system.gatherSelected(selectableId)) {
      this.update();
      return;
    }
    const target = this.pickAttackTarget(system, event.clientX, event.clientY);
    const hit = this.pick([terrain], event.clientX, event.clientY);
    if (target && resolveAttackTarget(
      system,
      "attack-any",
      target.id,
      hit?.point,
    )) {
      this.update();
      return;
    }
    if (hit) system.moveSelected(hit.point.x, hit.point.z);
    this.update();
  };

  private issueTarget(clientX: number, clientY: number) {
    const system = this.unitSystem();
    const terrain = this.world?.userData.terrain as THREE.Object3D | undefined;
    const mode = this.targetMode;
    if (!system || !terrain || !mode) return;
    const building = this.pickAttackTarget(system, clientX, clientY);
    const terrainHit = this.pick([terrain], clientX, clientY);
    // Ground attacks always use terrain, even when the ray also hits an enemy.
    const point = terrainHit?.point;
    if (mode === "move" && terrainHit) system.moveSelected(terrainHit.point.x, terrainHit.point.z);
    if (mode === "rally" && terrainHit) {
      system.setRallyPointSelected(terrainHit.point.x, terrainHit.point.z);
    }
    if (mode !== "move" && mode !== "rally") {
      resolveAttackTarget(system, mode, building?.id, point);
    }
    this.setTargetMode();
    this.update();
  }

  private stopSelected = () => {
    this.unitSystem()?.stopSelected();
    this.cancelBuild();
    this.setTargetMode();
    this.update();
  };

  private toggleBuildMenu() {
    if (!this.unitSystem()?.canSelectedBuild()) return;
    this.setTargetMode();
    this.placementKind = undefined;
    this.unitSystem()?.hideConstructionPreview();
    this.buildMenuOpen = !this.buildMenuOpen;
    this.renderedHudState = "";
    this.update();
  }

  private setPlacementKind(kind: BuildingKind) {
    this.targetMode = undefined;
    this.canvas.classList.remove("is-attacking");
    this.placementKind = kind;
    this.buildMenuOpen = true;
    this.canvas.classList.add("is-targeting");
    this.showConstructionPreview();
    this.renderedHudState = "";
    this.update();
  }

  private cancelBuild() {
    this.placementKind = undefined;
    this.buildMenuOpen = false;
    this.unitSystem()?.hideConstructionPreview();
    this.canvas.classList.toggle("is-targeting", Boolean(this.targetMode));
    this.renderedHudState = "";
  }

  private issueConstruction(clientX: number, clientY: number) {
    const system = this.unitSystem();
    const terrain = this.world?.userData.terrain as THREE.Object3D | undefined;
    const kind = this.placementKind;
    if (!system || !terrain || !kind || this.buildPending) return;
    const hit = this.pick([terrain], clientX, clientY);
    if (!hit) return;
    this.buildPending = true;
    const submitted = system.buildSelected(kind, hit.point.x, hit.point.z, (accepted) => {
      this.buildPending = false;
      if (accepted) this.cancelBuild();
      this.renderedHudState = "";
      this.update();
    });
    if (!submitted) this.buildPending = false;
    this.renderedHudState = "";
    this.update();
  }

  private setTargetMode(mode?: TargetMode) {
    this.unitSystem()?.hideAttackGroundPreview();
    if (mode) {
      this.placementKind = undefined;
      this.buildMenuOpen = false;
      this.unitSystem()?.hideConstructionPreview();
    }
    this.targetMode = mode;
    this.canvas.classList.toggle("is-attacking", Boolean(mode?.startsWith("attack")));
    this.canvas.classList.toggle("is-targeting", Boolean(mode));
    this.buttons && Object.entries(this.buttons).forEach(([action, button]) => {
      const active = mode === action || mode === "attack-any" && action.includes("attack");
      button.setAttribute("aria-pressed", String(active));
    });
    this.rallyButton?.setAttribute("aria-pressed", String(mode === "rally"));
    this.showAttackGroundPreview();
  }

  private rememberPointer(event: PointerEvent) {
    this.pointerInside = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  }

  private showAttackGroundPreview() {
    if (!this.pointerInside
      || this.targetMode !== "attack-ground" && this.targetMode !== "attack-any") return;
    const point = this.groundPoint(this.lastPointerX, this.lastPointerY);
    if (point) this.unitSystem()?.previewAttackGround(point.x, point.z);
    else this.unitSystem()?.hideAttackGroundPreview();
  }

  private showConstructionPreview() {
    const kind = this.placementKind;
    const terrain = this.world?.userData.terrain as THREE.Object3D | undefined;
    if (!this.pointerInside || !kind || !terrain) return;
    const hit = this.pick([terrain], this.lastPointerX, this.lastPointerY);
    if (hit) this.unitSystem()?.previewConstruction(kind, hit.point.x, hit.point.z);
    else this.unitSystem()?.hideConstructionPreview();
  }

  private pickAttackTarget(system: UnitSystem, clientX: number, clientY: number) {
    const hit = this.pick(system.attackables, clientX, clientY);
    let object: THREE.Object3D | undefined = hit?.object;
    while (object && !object.userData.buildingId && !object.userData.unitId) {
      object = object.parent ?? undefined;
    }
    const id = (object?.userData.buildingId ?? object?.userData.unitId) as string | undefined;
    return id && hit ? { id, point: hit.point } : undefined;
  }

  private groundPoint(clientX: number, clientY: number) {
    const system = this.unitSystem();
    const terrain = this.world?.userData.terrain as THREE.Object3D | undefined;
    if (!system || !terrain) return;
    return this.pick([terrain], clientX, clientY)?.point;
  }

  private pick(objects: THREE.Object3D[], clientX: number, clientY: number) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      (clientX - bounds.left) / bounds.width * 2 - 1,
      -(clientY - bounds.top) / bounds.height * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return pickSurface(this.raycaster.intersectObjects(objects, true));
  }

  private showSelectionBox(clientX: number, clientY: number) {
    this.selectionBox.hidden = false;
    this.selectionBox.style.left = `${Math.min(this.downX, clientX)}px`;
    this.selectionBox.style.top = `${Math.min(this.downY, clientY)}px`;
    this.selectionBox.style.width = `${Math.abs(clientX - this.downX)}px`;
    this.selectionBox.style.height = `${Math.abs(clientY - this.downY)}px`;
  }

  private unitsInBox(system: UnitSystem, clientX: number, clientY: number) {
    const bounds = this.canvas.getBoundingClientRect();
    const left = Math.min(this.downX, clientX);
    const right = Math.max(this.downX, clientX);
    const top = Math.min(this.downY, clientY);
    const bottom = Math.max(this.downY, clientY);
    return system.selectables.flatMap((unit) => {
      const id = unit.userData.unitId as string | undefined;
      if (!id) return [];
      unit.getWorldPosition(this.worldPosition);
      this.worldPosition.y += (unit.userData.selectionCenterY as number | undefined) ?? 1.1;
      this.worldPosition.project(this.camera);
      if (this.worldPosition.z < -1 || this.worldPosition.z > 1) return [];
      const x = bounds.left + (this.worldPosition.x + 1) * bounds.width / 2;
      const y = bounds.top + (1 - this.worldPosition.y) * bounds.height / 2;
      return x >= left && x <= right && y >= top && y <= bottom
        ? [id]
        : [];
    });
  }

  private cancelSelection = () => {
    this.pointerId = undefined;
    this.dragged = false;
    this.selectionBox.hidden = true;
  };

  private unitSystem() {
    return this.world?.userData.unitSystem as UnitSystem | undefined;
  }

  private matchResolved() {
    return Boolean(this.unitSystem()?.matchResult);
  }
}
