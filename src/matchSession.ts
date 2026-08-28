import {
  LocalUnitSimulation,
  SIMULATION_TICK_SECONDS,
  type DispatchResult,
  type BuildingState,
  type MatchResult,
  type PlayerCommand,
  type SimulationOptions,
  type SimulationEvent,
  type GameSimulation,
  type UnitState,
} from "./sim/units";
import type { ConstructionTerrain } from "./sim/construction";

export interface MatchFrame {
  version: number;
  tick: number;
  full: boolean;
  units: readonly UnitState[];
  buildings: readonly BuildingState[];
  removedUnitIds?: readonly string[];
  removedBuildingIds?: readonly string[];
  events: readonly SimulationEvent[];
  matchResult?: MatchResult;
}

export interface CommandSubmission {
  commandId: string;
  status: "accepted" | "rejected" | "queued";
  serverTick?: number;
  duplicate?: boolean;
}

export interface MatchSession {
  submit(command: PlayerCommand): CommandSubmission;
  advance(deltaSeconds: number): void;
  readFrame(afterVersion: number): MatchFrame | undefined;
  commandResult?(commandId: string): DispatchResult | undefined;
  dispose?(): void;
}

export class LocalMatchSession implements MatchSession {
  private accumulator = 0;
  private sequence = 0;
  private version = 1;
  private cachedFrame?: MatchFrame;

  constructor(
    private readonly playerId: string,
    private readonly simulation: GameSimulation,
  ) {}

  submit(command: PlayerCommand): CommandSubmission {
    const commandId = command.commandId ?? `${this.playerId}:${++this.sequence}`;
    const result = this.simulation.dispatch(this.playerId, { ...command, commandId });
    if (result.accepted && !result.duplicate) this.invalidateFrame();
    return submission(commandId, result);
  }

  advance(deltaSeconds: number) {
    if (this.simulation.matchResult) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += deltaSeconds;
    while (this.accumulator >= SIMULATION_TICK_SECONDS) {
      this.simulation.step();
      this.accumulator -= SIMULATION_TICK_SECONDS;
      this.invalidateFrame();
      if (this.simulation.matchResult) {
        this.accumulator = 0;
        break;
      }
    }
  }

  readFrame(afterVersion: number) {
    if (afterVersion >= this.version) return undefined;
    if (!this.cachedFrame) {
      this.cachedFrame = {
        version: this.version,
        tick: this.simulation.currentTick,
        full: true,
        units: this.simulation.snapshot(),
        buildings: this.simulation.buildingSnapshot(),
        events: this.simulation.drainEvents(),
        matchResult: this.simulation.matchResult,
      };
    }
    return this.cachedFrame;
  }

  dispose() {
    this.simulation.dispose();
  }

  private invalidateFrame() {
    this.version += 1;
    this.cachedFrame = undefined;
  }
}

export type ClientMatchMessage = { type: "command"; command: PlayerCommand };
export type ServerMatchMessage =
  | { type: "frame"; frame: MatchFrame }
  | { type: "command-result"; result: DispatchResult };

/** Transport-neutral client session; PartySocket only needs to send and feed these messages. */
export class RemoteMatchSession implements MatchSession {
  private sequence = 0;
  private readonly frames: MatchFrame[] = [];
  private latestVersion = 0;
  private readonly results = new Map<string, DispatchResult>();

  constructor(private readonly send: (message: ClientMatchMessage) => void) {}

  submit(command: PlayerCommand): CommandSubmission {
    const commandId = command.commandId ?? `command:${++this.sequence}`;
    this.send({ type: "command", command: { ...command, commandId } });
    return { commandId, status: "queued" };
  }

  advance(_deltaSeconds: number) {}

  readFrame(afterVersion: number) {
    while (this.frames[0] && this.frames[0].version <= afterVersion) this.frames.shift();
    return this.frames.shift();
  }

  receive(message: ServerMatchMessage) {
    if (message.type === "frame" && message.frame.version > this.latestVersion) {
      this.latestVersion = message.frame.version;
      this.frames.push(message.frame);
    }
    if (message.type === "command-result" && message.result.commandId) {
      this.results.set(message.result.commandId, message.result);
    }
  }

  commandResult(commandId: string) {
    return this.results.get(commandId);
  }
}

export type LocalWorkerMessage =
  | {
    type: "init";
    playerId: string;
    units: readonly UnitState[];
    buildings: readonly BuildingState[];
    terrain?: ConstructionTerrain;
    options?: SimulationOptions;
  }
  | ClientMatchMessage;

export class WorkerMatchSession implements MatchSession {
  private sequence = 0;
  private readonly frames: MatchFrame[];
  private latestVersion = 1;
  private readonly results = new Map<string, DispatchResult>();
  private readonly worker = new Worker(new URL("./sim/matchWorker.ts", import.meta.url), {
    type: "module",
  });

  constructor(
    playerId: string,
    units: readonly UnitState[],
    buildings: readonly BuildingState[],
    terrain?: ConstructionTerrain,
    options?: SimulationOptions,
  ) {
    this.frames = [{ version: 1, tick: 0, full: true, units, buildings, events: [] }];
    this.worker.onmessage = ({ data }: MessageEvent<ServerMatchMessage>) => {
      if (data.type === "frame" && data.frame.version > this.latestVersion) {
        this.latestVersion = data.frame.version;
        this.frames.push(data.frame);
      }
      if (data.type === "command-result" && data.result.commandId) {
        this.results.set(data.result.commandId, data.result);
      }
    };
    this.worker.postMessage({
      type: "init",
      playerId,
      units,
      buildings,
      terrain,
      options,
    } satisfies LocalWorkerMessage);
  }

  submit(command: PlayerCommand): CommandSubmission {
    const commandId = command.commandId ?? `local:${++this.sequence}`;
    this.worker.postMessage({
      type: "command",
      command: { ...command, commandId },
    } satisfies LocalWorkerMessage);
    return { commandId, status: "queued" };
  }

  advance(_deltaSeconds: number) {}

  readFrame(afterVersion: number) {
    while (this.frames[0] && this.frames[0].version <= afterVersion) this.frames.shift();
    return this.frames.shift();
  }

  commandResult(commandId: string) {
    return this.results.get(commandId);
  }

  dispose() {
    this.worker.terminate();
  }
}

export const createLocalMatchSession = (
  playerId: string,
  units: readonly UnitState[],
  buildings: readonly BuildingState[],
  terrain?: ConstructionTerrain,
  options?: SimulationOptions,
): MatchSession => typeof window === "undefined"
  ? new LocalMatchSession(playerId, new LocalUnitSimulation(units, buildings, terrain, options))
  : new WorkerMatchSession(playerId, units, buildings, terrain, options);

const submission = (commandId: string, result: DispatchResult): CommandSubmission => ({
  commandId,
  status: result.accepted ? "accepted" : "rejected",
  serverTick: result.serverTick,
  duplicate: result.duplicate,
});
