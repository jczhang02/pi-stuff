import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {registerNativeNamingPrototype} from './src/naming/native-panel.prototype';

// Throwaway UI branch: the product entrypoint mounts only the native prototype.
export default function (pi: ExtensionAPI) {
  registerNativeNamingPrototype(pi);
}
