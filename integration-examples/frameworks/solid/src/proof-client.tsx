import '@draftably/runtime/host.css';
import '../../proof.css';
import { hydrate } from 'solid-js/web';
import { Proof } from './Proof';

const props = JSON.parse(document.getElementById('proof-props')!.textContent!);
hydrate(() => <Proof {...props} />, document.getElementById('proof')!);
