import {getAgentDir, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {Effect} from 'effect';
import {ConfigurationFile} from './src/pi/configuration-file';
import {registerWeb} from './src/web/register';
import {registerRtk} from './src/rtk/register';
import {registerRtkPanel} from './src/rtk/panel';
import {registerUi} from './src/ui/register';
import {displayWebTools} from './src/ui/web';

export default async function (pi: ExtensionAPI) {
  const configuration = await Effect.runPromise(
    ConfigurationFile.load(join(getAgentDir(), 'pi-stuff.json')),
  );
  registerUi(pi, configuration.value.ui ?? {});
  registerWeb(
    pi,
    configuration.value.web ?? {},
    configuration.value.tools,
    configuration.value.ui?.enabled === false ? undefined : displayWebTools,
  );
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
