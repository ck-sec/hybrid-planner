import App from './App.tsx'
import CampaignApp from './campaign/CampaignApp.tsx'

export default function Root() {
  const legacy = new URLSearchParams(window.location.search).get('view') === 'legacy'
  return legacy ? <><a className="cf-archive-return" href={window.location.pathname}>Return to the mobile planner</a><App /></> : <CampaignApp />
}
