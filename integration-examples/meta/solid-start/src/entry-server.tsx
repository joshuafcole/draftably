// @refresh reload
import { createHandler, StartServer } from '@solidjs/start/server';

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Draftably host proof</title>
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  // Render the whole page before sending it, and put the nonce on SolidStart's own scripts.
  event => ({ mode: 'async', nonce: event.locals.nonce }),
);
