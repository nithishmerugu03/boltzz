import { Link, Route, Routes } from 'react-router-dom';
import IncidentList from './pages/IncidentList.jsx';
import Report from './pages/Report.jsx';
import WarRoom from './pages/WarRoom.jsx';

export default function App() {
  return (
    <div className="min-h-screen text-slate-900">
      <header className="no-print border-b border-slate-200 bg-slate-900 px-6 py-3 text-white">
        <Link to="/" className="font-semibold">AegisOps · Incident War Room</Link>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        <Routes>
          <Route path="/" element={<IncidentList />} />
          <Route path="/incidents/:id" element={<WarRoom />} />
          <Route path="/incidents/:id/report" element={<Report />} />
        </Routes>
      </main>
    </div>
  );
}
