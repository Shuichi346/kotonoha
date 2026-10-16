import { createRoot } from 'react-dom/client';
import { Controls } from './Controls';
import { Overlay } from './Overlay';
import { useLive } from './useLive';
import './styles.css';
const subtitleView = new URLSearchParams(location.search).get('view') === 'subtitles';
document.documentElement.classList.toggle('subtitle-view', subtitleView);
function App() {
  const live = useLive();
  return subtitleView ? <Overlay live={live}/> : <Controls live={live}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
