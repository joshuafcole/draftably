import '@draftably/runtime/host.css';
import '../../proof.css';
import { hydrateRoot } from 'react-dom/client';
import { Proof } from './Proof';

const props = JSON.parse(document.getElementById('proof-props')!.textContent!);
hydrateRoot(document.getElementById('proof')!, <Proof {...props} />);
