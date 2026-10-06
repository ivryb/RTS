import { TERRAINS, type TerrainVersion } from './directions';
import type { createCompositeScene } from './compositeScene';

type Study = ReturnType<typeof createCompositeScene>;
export type TerrainView = keyof Study['views'];

export function createDirectionControls(actions: {
  change: (version: TerrainVersion) => void;
  focus: (view: TerrainView, close: boolean) => void;
  render: () => void;
}) {
  const navigation = document.querySelector<HTMLElement>('#terrain-nav')!;
  const buttons = new Map<TerrainVersion, HTMLButtonElement>();
  for (const version of ['old', 'new'] as const) {
    const button = document.createElement('button');
    button.textContent = TERRAINS[version].name;
    button.dataset.terrain = version;
    button.onclick = () => actions.change(version);
    navigation.append(button);
    buttons.set(version, button);
  }
  const panel = document.createElement('section');
  panel.id = 'terrain-inspector';
  panel.setAttribute('aria-label', 'Scene views and details');
  panel.innerHTML = `
    <div id="terrain-views"><div class="study-actions">
      <button id="landscape-view">Landscape</button>
      <button id="grove-view">Grove</button>
    </div><div class="study-actions"><button id="units-view">Units in grass</button></div></div>
    <label class="study-check"><input id="study-plants" type="checkbox" checked> Vegetation</label>
    <label class="study-check"><input id="study-reference" type="checkbox" checked> Buildings & units</label>
    <label class="study-check"><input id="study-labels" type="checkbox"> Site labels</label>`;
  document.body.append(panel);
  let study: Study | undefined;
  const plants = panel.querySelector<HTMLInputElement>('#study-plants')!;
  const reference = panel.querySelector<HTMLInputElement>('#study-reference')!;
  const labels = panel.querySelector<HTMLInputElement>('#study-labels')!;
  panel.querySelector<HTMLButtonElement>('#landscape-view')!.onclick = () => actions.focus('landscape', true);
  panel.querySelector<HTMLButtonElement>('#grove-view')!.onclick = () => actions.focus('grove', true);
  panel.querySelector<HTMLButtonElement>('#units-view')!.onclick = () => {
    reference.checked=true;
    if(study)study.reference.visible=true;
    actions.focus('units', false);
    actions.render();
  };
  plants.onchange = () => { if (study) study.vegetation.visible = plants.checked; actions.render(); };
  reference.onchange = () => { if (study) study.reference.visible = reference.checked; actions.render(); };
  labels.onchange = () => { document.body.classList.toggle('hide-site-labels', !labels.checked); actions.render(); };
  return {
    refresh(version: TerrainVersion, nextStudy: Study | undefined) {
      study = nextStudy;
      for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === version));
      document.body.dataset.variant = version;
      document.body.classList.toggle('hide-site-labels', !labels.checked);
      panel.querySelector<HTMLElement>('#terrain-views')!.hidden = !study;
      plants.parentElement!.hidden = !study;
      reference.parentElement!.hidden = !study;
      if (study) {
        study.vegetation.visible = plants.checked;
        study.reference.visible = reference.checked;
      }
    },
  };
}
