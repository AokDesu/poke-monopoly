import fixtures from 'virtual:gallery-fixtures';
import { GalleryPage } from './GalleryPage.tsx';

/** The dev route's entry: hands the plugin's fixtures to the page (the tests pass their own). */
export default function GalleryRoute() {
  return <GalleryPage fixtures={fixtures} />;
}
