import '@draftably/runtime/host.css';
import '../../proof.css';
import { hydrate } from 'svelte';
import Proof from './Proof.svelte';

const props = JSON.parse(document.getElementById('proof-props')!.textContent!);
hydrate(Proof, { target: document.getElementById('proof')!, props });
