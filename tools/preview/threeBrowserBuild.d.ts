// Specs import three's browser build by path inside page.evaluate, where bare specifiers do not resolve.
declare module "*/node_modules/three/build/three.module.js" {
  export * from "three";
}
