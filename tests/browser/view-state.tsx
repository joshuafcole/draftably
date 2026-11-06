// Two read-only editors driven by a host, for `pnpm prove:view-state`. Each records what its
// session reports: selections, hovers and activations.
import { mountEditor, type MountedEditor, type ViewItem } from '../../src/editor';

const source = (name: string) =>
  `diagram "${name}" version=1\ngroup lane "${name} lane"\nnode a "${name} start" in=lane\nnode b "${name} end"\nedge ab a -> b "next"\n`;

const reports = [0, 1].map(() => ({
  selected: [] as ViewItem[][],
  hovered: [] as Array<ViewItem | null>,
  activated: [] as ViewItem[],
}));
const editors: MountedEditor[] = ['Left', 'Right'].map((name, i) =>
  mountEditor(document.getElementById(name.toLowerCase())!, {
    source: source(name),
    readOnly: true,
    onSelect: items => reports[i].selected.push(items),
    onHover: item => reports[i].hovered.push(item),
    onActivate: item => reports[i].activated.push(item),
  }),
);

Object.assign(window, { editors, reports });
