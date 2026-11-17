import { AppShell } from './shell/AppShell'
import { PlayerBarPlaceholder } from './shell/PlayerBarPlaceholder'

function App(): React.JSX.Element {
  return (
    <AppShell
      renderShelf={() => <nav aria-label="Readings" className="flex-1" />}
      stage={<main className="h-full" />}
      player={<PlayerBarPlaceholder />}
    />
  )
}

export default App
