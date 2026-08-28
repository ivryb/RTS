import createRecastModule from "@recast-navigation/wasm/wasm";
import type { NavigationModuleFactory } from "../../src/sim/navigation";

export const cloudflareNavigationModule = (
  wasm: WebAssembly.Module,
): NavigationModuleFactory => {
  const createModule = () => createRecastModule({
    instantiateWasm(
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      const instance = new WebAssembly.Instance(wasm, imports);
      receiveInstance(instance, wasm);
      return instance.exports;
    },
  });
  return createModule as NavigationModuleFactory;
};
