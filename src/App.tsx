import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { NarrowScreenGate } from './components/NarrowScreenGate'
import { DeepLink } from './components/DeepLink'
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
import { Link } from 'react-router-dom'

function NotFound() {
  return (
    <div className="py-16 text-center">
      <div className="text-lg font-medium mb-1">页面不存在</div>
      <div className="text-sm text-slate-400 mb-4">这个地址没有对应的页面，可能是链接输错了。</div>
      <Link to="/" className="text-sm text-brand hover:underline">返回仪表盘</Link>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SidekickProvider>
        {/* 放在 Routes 外面：飞书回跳的 ?ask= 与落在哪个页面无关，不该被路由切换重置。 */}
        <DeepLink />
        <Routes>
          {/* /selftest 独立于业务外壳之外：P0 部署连通性验证，不进左侧导航（见 Ruling T2-A） */}
          <Route path="/selftest" element={<SelfTest />} />
          <Route
            path="/*"
            element={
              // 按宽度分发外壳：手机走 MobileApp（问答优先），768~1023 换说明卡，够宽才是三栏工作台。
              // 只套在业务外壳外面：/selftest 是部署连通性验证页，不需要这层分发。
              <NarrowScreenGate>
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
                    {/* 没有这条兜底时，任何打错的地址都渲染成一片空白——外壳在、内容区空，
                        看的人分不清是路由错了还是页面崩了。实探时就是这样丢了一次信任。 */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppShell>
              </NarrowScreenGate>
            }
          />
        </Routes>
      </SidekickProvider>
    </BrowserRouter>
  )
}
