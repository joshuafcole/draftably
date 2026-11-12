import '@draftably/runtime/host.css';
import '../../slots.css';
import { render } from 'solid-js/web';
import { App } from './App';

render(() => <App />, document.getElementById('app')!);
