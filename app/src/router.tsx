import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '@app/components/shell/AppShell'
import { HomePage, SessionPage } from '@app/routes/pages'
import { PanelView } from '@app/routes/PanelView'
import { LoginPage } from '@app/routes/LoginPage'
import type { PanelName } from '@app/stores/ui'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
})

const sessionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/session/$id',
  component: function SessionRouteComponent() {
    const { id } = sessionRoute.useParams()
    return <SessionPage sessionId={id} />
  },
})

const panelRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/panel/$name',
  component: function PanelRouteComponent() {
    const { name } = panelRoute.useParams()
    const valid: PanelName[] = [
      'sessions',
      'workspace',
      'skills',
      'memory',
      'cron',
      'profiles',
      'settings',
    ]
    if (!valid.includes(name as PanelName)) {
      throw redirect({ to: '/' })
    }
    return <PanelView name={name as PanelName} />
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([indexRoute, sessionRoute, panelRoute]),
  loginRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
