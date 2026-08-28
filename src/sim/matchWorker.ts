import type {
  LocalWorkerMessage,
  MatchFrame,
  ServerMatchMessage,
} from "../matchSession";
import { LocalUnitSimulation, SIMULATION_TICK_SECONDS } from "./units";
import { initializeNavigation } from "./navigation";

type WorkerScope = {
  onmessage: ((event: MessageEvent<LocalWorkerMessage>) => void) | null;
  postMessage(message: ServerMatchMessage): void;
};

const scope = globalThis as unknown as WorkerScope;
let simulation: LocalUnitSimulation | undefined;
let playerId = "";
let version = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let previousTime = performance.now();
let accumulator = 0;

const publishFrame = () => {
  if (!simulation) return;
  const frame: MatchFrame = {
    version: ++version,
    tick: simulation.currentTick,
    full: true,
    units: simulation.snapshot(),
    buildings: simulation.buildingSnapshot(),
    events: simulation.drainEvents(),
    matchResult: simulation.matchResult,
  };
  scope.postMessage({ type: "frame", frame });
};

const pump = () => {
  if (!simulation || simulation.matchResult) return;
  const now = performance.now();
  accumulator += Math.min((now - previousTime) / 1_000, 0.5);
  previousTime = now;
  let stepped = false;
  while (accumulator >= SIMULATION_TICK_SECONDS) {
    simulation.step();
    accumulator -= SIMULATION_TICK_SECONDS;
    stepped = true;
    if (simulation.matchResult) {
      accumulator = 0;
      break;
    }
  }
  if (stepped) publishFrame();
  if (simulation.matchResult && timer) {
    clearInterval(timer);
    timer = undefined;
  }
};

scope.onmessage = async ({ data }) => {
  if (data.type === "init") {
    await initializeNavigation();
    playerId = data.playerId;
    simulation?.dispose();
    simulation = new LocalUnitSimulation(data.units, data.buildings, data.terrain, data.options);
    previousTime = performance.now();
    accumulator = 0;
    publishFrame();
    timer ??= setInterval(pump, 25);
    return;
  }
  if (!simulation) return;
  const result = simulation.dispatch(playerId, data.command);
  scope.postMessage({ type: "command-result", result });
  if (result.accepted && !result.duplicate) publishFrame();
};

void timer;
