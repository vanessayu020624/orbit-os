import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Opportunities from './pages/Opportunities'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Receivables from './pages/Receivables'
import SelfTest from './pages/SelfTest'
import AgentPage from './pages/AgentPage'
import { Sidekick } from './sidekick/Sidekick'
import { SidekickProvider } from './sidekick/SidekickProvider'

export default function App() {
  return (
    <BrowserRouter>
      <SidekickProvider>
        <Routes>
          {/* /selftest 独立于业务外壳之外：P0 部署连通性验证，不进左侧导航（见 Ruling T2-A） */}
          <Route path="/selftest" element={<SelfTest />} />
          <Route
            path="/*"
            element={
              <AppShell sidekick={<Sidekick />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/opportunities" element={<Opportunities />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/purchases" element={<Purchases />} />
                  <Route path="/receivables" element={<Receivables />} />
                  <Route path="/agent" element={<AgentPage />} />
                </Routes>
              </AppShell>
            }
          />
        </Routes>
      </SidekickProvider>
    </BrowserRouter>
  )
}
