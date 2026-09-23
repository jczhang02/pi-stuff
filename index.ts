import {getAgentDir, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {Effect} from 'effect';
import {ConfigurationFile} from './src/pi/configuration-file';
import {registerWeb} from './src/web/register';
import {registerRtk} from './src/rtk/register';
import {registerRtkPanel} from './src/rtk/panel';
import {registerNaming} from './src/naming/register';
import {registerNamingPanel} from './src/naming/panel';

export default async function (pi: ExtensionAPI) {
  const configuration = await Effect.runPromise(
    ConfigurationFile.load(join(getAgentDir(), 'pi-stuff.json')),
  );
  const naming = registerNaming(pi, configuration.value.naming);
  registerNamingPanel(pi, naming, async settings => {
    const previous = configuration.value.naming;
    try {
      await Effect.runPromise(configuration.saveNaming(settings));
    } finally {
      // Cancel old requests only after the new configuration was committed.
      if (configuration.value.naming !== previous)
        naming.update(configuration.value.naming ?? {});
    }
  });
  registerWeb(pi, configuration.value.web ?? {}, configuration.value.tools);
  const rtk = registerRtk(pi, configuration.value.rtk ?? {});
  registerRtkPanel(pi, rtk, async settings => {
    try {
      await Effect.runPromise(configuration.saveRtk(settings));
    } finally {
      // A committed rename remains effective even if lock cleanup fails.
      rtk.update(configuration.value.rtk ?? {});
    }
  });
}
