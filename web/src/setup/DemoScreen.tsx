import type { DemoScene, SceneFailure } from '../game/demoScenes.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceButton } from '../ui/Choice.tsx';
import { Screen } from '../ui/Screen.tsx';

interface DemoScreenProps {
  scenes: readonly DemoScene[];
  /** Why the last scene could not be built; the list stays so another can be picked. */
  failure?: SceneFailure;
  onOpen: (scene: DemoScene) => void;
  onBack: () => void;
}

function failureText(failure: SceneFailure): string {
  switch (failure.kind) {
    case 'step':
      return t('demo.failed.step', { step: failure.step, total: failure.total });
    case 'moment':
      return t('demo.failed.moment');
    case 'engine':
      return t('demo.failed.engine', { message: failure.message });
  }
}

/** Demo mode only (`?demo`, spec §3, §11): the prepared scenarios, each with one line. */
export function DemoScreen({ scenes, failure, onOpen, onBack }: DemoScreenProps) {
  return (
    <Screen
      heading={t('demo.scenes.heading')}
      body={t('demo.scenes.body')}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t('nav.home')}
        </Button>
      }
    >
      {failure && (
        <div role="alert" className="panel mb-8 max-w-2xl p-5 text-pretty">
          <h2 className="text-xl">{t('demo.failed.heading')}</h2>
          <p className="mt-2">{failureText(failure)}</p>
          <p className="mt-2 text-ink-soft">{t('demo.failed.next')}</p>
        </div>
      )}
      {scenes.length === 0 ? (
        <p role="status" className="panel max-w-2xl p-5 text-pretty">
          {t('demo.scenes.none')}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-6">
          {scenes.map((scene) => (
            <li key={scene.id}>
              <ChoiceButton
                title={t(scene.title)}
                description={t(scene.description)}
                onClick={() => onOpen(scene)}
              />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
