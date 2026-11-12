import '@draftably/runtime/host.css';
import '../../proof.css';
import { createSSRApp } from 'vue';
import { Proof } from './Proof';

const props = JSON.parse(document.getElementById('proof-props')!.textContent!);
createSSRApp(Proof, props).mount('#proof');
