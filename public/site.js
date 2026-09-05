// Preserve bookmarks from when the planner lived at the homepage.
const address = new URL(location.href)
if (address.searchParams.get('view') === 'legacy' || address.hash.startsWith('#session/')) {
  const planner = new URL('./app/', address)
  planner.search = address.search
  planner.hash = address.hash
  location.replace(planner.href)
}
