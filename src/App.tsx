import { resolveAppearance } from './model/appearance';
import { registerFonts } from './lib/font-data';
import { createEffect, onCleanup, onMount, Show } from 'solid-js';
import { Canvas } from './components/canvas/Canvas';
import { SceneHostContext } from './components/scene/host';
import { ComparisonDialog } from './components/comparison/ComparisonDialog';
import { Dialogs } from './components/Dialogs';
import { ExampleBar } from './components/ExampleBar';
import { FileBanner } from './components/FileBanner';
import { Menus } from './components/Menus';
import { Sidebar } from './components/Sidebar';
import { StartScreen } from './components/StartScreen';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { Tips } from './components/Tips';
import { Toolbar } from './components/Toolbar';
import { finishInlineEdit } from './state/actions';
import { setFilePicker } from './state/commands';
import { cancelGeneration, closeComparison } from './state/comparison';
import { installDebugApi } from './state/debug-api';
import { doc, persistNow, restoreSavedDocument, watchOtherTabs } from './state/document';
import { fitView, setReducedMotion, setSpaceHeld } from './state/editor';
import { exampleEdited, exampleMode, fileMode, leaveAgreed } from './state/file-session';
import { importForeignText, openFile } from './state/files';
import { onLeaveFile, setStartOpen, startOpen } from './state/launch';
import { handleCopy, handleKeyDown, handleKeyUp, handlePaste } from './state/keyboard';
import { cancelLayout } from './state/layout';
import { resetModifiers } from './state/pointer';
import { editorSceneHost } from './state/scene-host';
import { restoreArchive, sculptBeforeUnload, sculptBlur } from './state/sculpt';
import { toast } from './state/toast';
import {
  filesShown,
  inspectorOpen,
  inspectorWidth,
  objectsOpen,
  showError,
  sidebarWidth,
} from './state/ui';
import './styles/app.css';

/** Add an event listener and return a function that removes it. */
function listen<E extends Event>(
  target: EventTarget,
  type: string,
  handler: (event: E) => unknown,
) {
  const listener = handler as unknown as EventListener;
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

// Switching files in place closes Compare, which belongs to the drawing it was opened on.
onLeaveFile(closeComparison);

export default function App() {
  let diagramInput!: HTMLInputElement;
  let imageInput!: HTMLInputElement;
  let replaceImageId: string | null = null;
  let foreignOnly = false;

  setFilePicker((replaceId, accept) => {
    replaceImageId = replaceId;
    foreignOnly = accept === 'foreign';
    const input = accept === 'image' ? imageInput : diagramInput;
    if (input === diagramInput)
      input.accept = foreignOnly
        ? '.dot,.gv,.mmd,.mermaid,.d2,.md,.txt'
        : '.json,.svg,.dot,.gv,.mmd,.mermaid,.d2,image/png,image/jpeg,image/webp,image/gif';
    input.value = '';
    input.click();
  });

  const onFiles = async (e: Event & { currentTarget: HTMLInputElement }) => {
    try {
      for (const file of e.currentTarget.files ?? []) {
        if (foreignOnly) {
          if (file.size > 256 * 1024) throw Error('Use a diagram smaller than 256 KB.');
          await importForeignText(await file.text(), file.name);
        } else await openFile(file, replaceImageId);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      replaceImageId = null;
      foreignOnly = false;
    }
  };

  createEffect(() => {
    document.documentElement.dataset.theme = doc.theme;
  });
  // The diagram's canvas follows its appearance; editor chrome follows the editor's mode.
  createEffect(() => {
    document.documentElement.style.setProperty(
      '--diagram-canvas',
      resolveAppearance(doc.appearance).canvas,
    );
  });
  registerFonts();

  onMount(() => {
    installDebugApi();
    const { restored, notice } = restoreSavedDocument();
    restoreArchive();
    // A first visit to the static site starts on the start screen instead of a blank canvas.
    if (!restored && !fileMode()) setStartOpen(true);
    requestAnimationFrame(() => {
      if (!restored) fitView();
      if (notice) toast(notice);
    });
    console.info('[diagram-studio] ready', {
      restored,
      objects: doc.graph.nodes.length + doc.graph.groups.length,
    });

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    const onBlur = () => {
      sculptBlur();
      resetModifiers();
      setSpaceHeld(false);
    };
    // Edits to an example are not in any file; the browser asks first. A label or field still
    // being typed is committed before the check (fields commit on blur), so it counts too.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      finishInlineEdit(true);
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (!exampleEdited() || leaveAgreed()) return;
      e.preventDefault();
      // Older Chrome and Safari show the prompt only when returnValue is set.
      e.returnValue = '';
    };
    const onUnload = () => {
      sculptBeforeUnload();
      finishInlineEdit(true);
      persistNow();
    };
    const cleanups = [
      listen(document, 'keydown', handleKeyDown),
      listen(document, 'keyup', handleKeyUp),
      listen(document, 'copy', handleCopy),
      listen(document, 'paste', handlePaste),
      listen(window, 'blur', onBlur),
      listen(window, 'beforeunload', onBeforeUnload),
      listen(window, 'beforeunload', onUnload),
      listen(motion, 'change', onMotion),
    ];
    const stopWatching = watchOtherTabs();
    onCleanup(() => {
      cleanups.forEach(stop => stop());
      stopWatching();
      cancelLayout();
      cancelGeneration();
      onUnload();
    });
  });

  return (
    <SceneHostContext.Provider value={editorSceneHost}>
      <div
        class="app"
        style={{
          '--sidebar-width': `${sidebarWidth()}px`,
          '--inspector-width': `${inspectorWidth()}px`,
        }}
        classList={{
          'objects-open': objectsOpen(),
          'inspector-open': inspectorOpen(),
          'example-mode': exampleMode(),
        }}
      >
        <Toolbar />
        <div class="mode-bar-slot">
          <Show when={exampleMode()}>
            <ExampleBar />
          </Show>
        </div>
        <div class="workspace">
          <Show when={filesShown() || objectsOpen()}>
            <Sidebar />
          </Show>
          {/* The banner centers over the canvas and never covers a panel. */}
          <div class="canvas-area">
            <Canvas />
            <FileBanner />
          </div>
          <Show when={inspectorOpen()}>
            <RightPanel />
          </Show>
        </div>
        <StatusBar />
        <Menus />
        <Dialogs />
        <ComparisonDialog />
        <Toast />
        <Tips />
        <Show when={startOpen()}>
          <StartScreen variant="dialog" />
        </Show>
        <input
          ref={diagramInput}
          type="file"
          hidden
          accept=".json,.svg,.dot,.gv,.mmd,.mermaid,.d2,image/png,image/jpeg,image/webp,image/gif"
          onChange={onFiles}
        />
        <input
          ref={imageInput}
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onFiles}
        />
      </div>
    </SceneHostContext.Provider>
  );
}
