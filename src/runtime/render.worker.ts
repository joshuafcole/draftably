// One render per message. The page's pool queues jobs and gives each worker one at a time.
import { renderSvg } from './render';
import type { RenderOptions } from './types';

type Request = { id: number; source: string; options: RenderOptions };
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
  postMessage(data: unknown): void;
};
scope.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, source, options } = event.data;
  try {
    scope.postMessage({ id, result: await renderSvg(source, options) });
  } catch {
    scope.postMessage({
      id,
      result: {
        ok: false,
        reason: 'internal',
        diagnostics: [
          {
            code: 'DRAFT_INTERNAL',
            severity: 'error',
            message: 'The diagram could not be rendered.',
            itemIds: [],
          },
        ],
      },
    });
  }
});
