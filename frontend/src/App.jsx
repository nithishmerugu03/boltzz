import { Link, Route, Routes, useParams } from 'react-router-dom';
import IncidentList from './pages/IncidentList.jsx';
import RcaSecurityDashboard from './pages/RcaSecurityDashboard.jsx';
import Report from './pages/Report.jsx';
import WarRoom, { useReport } from './pages/WarRoom.jsx';

// Feeds the workflow's rca_security_analysis output into the RCA & Security dashboard.
function RcaSecurityRoute() {
  const { id } = useParams();
  const { report, error } = useReport(id);
  return (
    <>
      <Link to={`/incidents/${id}`} className="text-sm text-blue-600 underline">← War room</Link>
      <RcaSecurityDashboard
        incident={report?.incident ?? null}
        result={report?.incident?.rca_security_analysis ?? null}
        loading={!report && !error}
        error={error || null}
      />
    </>
  );
}

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
          <Route path="/incidents/:id/rca" element={<RcaSecurityRoute />} />
          <Route path="/incidents/:id/report" element={<Report />} />
        </Routes>
      </main>
    </div>
  );
}
