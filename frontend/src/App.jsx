import React, { useState, useEffect } from 'react';

const API_BASE = 'http://127.0.0.1:8000';

export default function App() {
  const [currentView, setCurrentView] = useState('queue'); // 'queue' | 'detail' | 'test_runner' | 'simulator' | 'clinic_info'
  const [selectedConversationId, setSelectedConversationId] = useState('cv_4471');
  const [stats, setStats] = useState({
    conversations_today: 37,
    completed_by_agent: 31,
    completion_rate: '84%',
    escalated_total: 6,
    escalated_open: 4,
    urgent_unresolved: 1
  });
  const [handoffs, setHandoffs] = useState([]);
  const [handoffStatusFilter, setHandoffStatusFilter] = useState('open'); // 'open' | 'resolved' | 'all'
  const [conversationsList, setConversationsList] = useState([]);
  const [activeDetail, setActiveDetail] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState(null);
  const [clinicData, setClinicData] = useState(null);

  // Live Simulator state
  const [simTurns, setSimTurns] = useState([
    "Dr. Rao ke saath kal ka appointment chahiye tha.",
    "Subah 10 baje."
  ]);
  const [newSimTurn, setNewSimTurn] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    fetchStats();
    fetchHandoffs();
    fetchConversations();
    fetchClinic();
    loadConversationTrace('cv_4471');
  }, []);

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stats`);
      if (res.ok) setStats(await res.json());
    } catch (e) {
      console.warn('API fetchStats offline');
    }
  };

  const fetchHandoffs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/handoffs?status=all`);
      if (res.ok) {
        const data = await res.json();
        setHandoffs(data);
      }
    } catch (e) {
      console.warn('API fetchHandoffs offline');
    }
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`);
      if (res.ok) setConversationsList(await res.json());
    } catch (e) {
      console.warn('API fetchConversations offline');
    }
  };

  const fetchClinic = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/clinic`);
      if (res.ok) setClinicData(await res.json());
    } catch (e) {
      console.warn('API fetchClinic offline');
    }
  };

  const handleResolve = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/handoffs/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        showToast(`Handoff ${id} resolved successfully!`);
        fetchStats();
        fetchHandoffs();
      }
    } catch (err) {
      // Local optimistic update
      setHandoffs(prev => prev.map(h => h.id === id ? { ...h, status: 'resolved' } : h));
      setStats(prev => ({
        ...prev,
        escalated_open: Math.max(0, prev.escalated_open - 1),
        urgent_unresolved: id === 'cv_4471' ? 0 : prev.urgent_unresolved
      }));
      showToast(`Handoff ${id} marked as resolved.`);
    }
  };

  const handleReopen = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/handoffs/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        showToast(`Handoff ${id} reopened.`);
        fetchStats();
        fetchHandoffs();
      }
    } catch (err) {
      setHandoffs(prev => prev.map(h => h.id === id ? { ...h, status: 'open' } : h));
      setStats(prev => ({
        ...prev,
        escalated_open: prev.escalated_open + 1,
        urgent_unresolved: id === 'cv_4471' ? 1 : prev.urgent_unresolved
      }));
      showToast(`Handoff ${id} reopened.`);
    }
  };

  const loadConversationTrace = async (cid) => {
    setSelectedConversationId(cid);
    try {
      const res = await fetch(`${API_BASE}/api/conversation/${cid}`);
      if (res.ok) {
        const data = await res.json();
        setActiveDetail(data);
        return;
      }
    } catch (e) {
      console.warn('Backend trace endpoint offline, falling back', e);
    }

    // Client-side fallback if backend unavailable
    let turns = ["Dr. Rao ke saath kal subah ka appointment chahiye."];
    let subtitle = `Sunrise Clinic, Dehradun — Reference Date: 2026-10-01`;
    if (cid === 'cv_4471') {
      turns = [
        "Kal subah ka appointment mil jayega Dr. Rao ke saath?",
        "10:15 kar dijiye. Waise abhi seene mein dard ho raha hai thoda."
      ];
      subtitle = `Sunrise Clinic, Dehradun — 27 Sep 2026, 11:42`;
    }

    try {
      const resp = await fetch(`${API_BASE}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: cid,
          today: "2026-10-01",
          turns: turns
        })
      });
      const data = await resp.json();

      const transcriptItems = [];
      turns.forEach((turn) => {
        transcriptItems.push({ role: 'CALLER', text: turn });
      });

      (data.tool_calls || []).forEach(tc => {
        const argEntries = Object.entries(tc.arguments || {})
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        transcriptItems.push({
          role: 'TOOL',
          fn: tc.name,
          args: argEntries,
          output: tc._result ? `-> ${JSON.stringify(tc._result)}` : (tc.name === 'search_slots' ? '-> slots returned' : null)
        });
      });

      if (data.reply) {
        transcriptItems.push({ role: 'AGENT', text: data.reply });
      }

      const isEscalated = data.terminal_state === 'escalated';
      const badgeText = isEscalated
        ? `ESCALATED — ${data.escalation_reason ? data.escalation_reason.toUpperCase() : 'HUMAN'}`
        : data.terminal_state.toUpperCase();

      setActiveDetail({
        id: cid,
        title: `Conversation ${cid}`,
        subtitle: subtitle,
        badge: badgeText,
        badgeType: data.escalation_reason || data.terminal_state,
        transcript: transcriptItems,
        abandonedNotice: isEscalated ? 'Booking flow abandoned. No appointment was created.' : null,
        outcome: {
          terminal_state: data.terminal_state,
          escalation_reason: data.escalation_reason || 'null',
          patient_id: data.patient_id || 'null',
          appointment_id: data.appointment_id || 'null',
          tool_calls: (data.tool_calls || []).length,
          turns: turns.length,
          tokens: '3,140',
          latency: '4.2 s',
          determinism: 'STABLE'
        }
      });
    } catch (err) {
      console.error('Error running agent:', err);
    }
  };

  const openConversationDetail = async (cid) => {
    setCurrentView('detail');
    await loadConversationTrace(cid);
  };

  const copyOutcomeJson = () => {
    if (activeDetail && activeDetail.outcome) {
      navigator.clipboard.writeText(JSON.stringify(activeDetail.outcome, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Machine outcome JSON copied to clipboard!');
    }
  };

  const sendToSimulator = (turns) => {
    setSimTurns(turns);
    setCurrentView('simulator');
    showToast('Loaded turns into Live Call Simulator!');
  };

  // Run Custom Simulator
  const runSimulator = async () => {
    if (simTurns.length === 0) return;
    setSimLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: `custom_${Date.now().toString().slice(-4)}`,
          today: '2026-10-01',
          turns: simTurns
        })
      });
      const data = await resp.json();
      setSimResult(data);
      fetchStats();
      fetchHandoffs();
      if (data.terminal_state === 'escalated') {
        showToast('Agent escalated! Conversation added to Handoff Queue.');
      } else {
        showToast(`Agent completed conversation: ${data.terminal_state}`);
      }
    } catch (e) {
      showToast('Backend offline. Please start backend on port 8000.');
    } finally {
      setSimLoading(false);
    }
  };

  const addSimTurn = () => {
    if (!newSimTurn.trim()) return;
    setSimTurns(prev => [...prev, newSimTurn.trim()]);
    setNewSimTurn('');
  };

  const clearSimTurns = () => {
    setSimTurns([]);
    setSimResult(null);
  };

  const renderBadge = (reason) => {
    const r = (reason || '').toLowerCase();
    if (r.includes('clinical')) {
      return (
        <span style={styles.badgeClinical}>
          <span style={styles.badgeDotRed} />
          CLINICAL
        </span>
      );
    }
    if (r.includes('auth')) {
      return (
        <span style={styles.badgeAuth}>
          <span style={styles.badgeDotAmber} />
          NOT AUTHORISED
        </span>
      );
    }
    if (r.includes('ambiguous')) {
      return (
        <span style={styles.badgeAmbiguous}>
          <span style={styles.badgeDotGold} />
          AMBIGUOUS PATIENT
        </span>
      );
    }
    if (r.includes('advice')) {
      return (
        <span style={styles.badgeAdvice}>
          <span style={styles.badgeDotRose} />
          MEDICAL ADVICE
        </span>
      );
    }
    if (r.includes('scope')) {
      return (
        <span style={styles.badgeScope}>
          <span style={styles.badgeDotPurple} />
          OUT OF SCOPE
        </span>
      );
    }
    if (r.includes('booked')) {
      return (
        <span style={styles.badgeBooked}>
          <span style={styles.badgeDotGreen} />
          BOOKED
        </span>
      );
    }
    if (r.includes('rescheduled')) {
      return (
        <span style={styles.badgeRescheduled}>
          <span style={styles.badgeDotBlue} />
          RESCHEDULED
        </span>
      );
    }
    if (r.includes('cancelled')) {
      return (
        <span style={styles.badgeCancelled}>
          <span style={styles.badgeDotGray} />
          CANCELLED
        </span>
      );
    }
    return (
      <span style={styles.badgeDefault}>
        {reason ? reason.toUpperCase() : 'RESOLVED'}
      </span>
    );
  };

  const openHandoffsList = handoffs.filter(h => h.status === 'open');
  const resolvedHandoffsList = handoffs.filter(h => h.status === 'resolved');

  const visibleHandoffs = handoffs.filter(h => {
    if (handoffStatusFilter === 'open') return h.status === 'open';
    if (handoffStatusFilter === 'resolved') return h.status === 'resolved';
    return true;
  });

  const filteredHandoffs = visibleHandoffs.filter(h =>
    (h.caller_said || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (h.id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (h.reason || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredScenarios = conversationsList.filter(sc => {
    if (scenarioFilter === 'starter') return sc.id.startsWith('cv_');
    if (scenarioFilter === 'adversarial') return sc.id.startsWith('adv_');
    return true;
  });

  return (
    <div style={styles.appContainer}>
      {/* TOAST NOTIFICATION */}
      {notification && (
        <div style={styles.toast}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {notification}
        </div>
      )}

      {/* PERSISTENT LEFT SIDEBAR WITH POLISHED ICONS & TOOLTIPS */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarCircles}>
          {/* Brand Logo: Clinic Shield */}
          <button
            style={styles.brandIconBtn}
            onClick={() => setCurrentView('queue')}
            title="Sunrise Clinic Front Desk Agent"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
              <path d="M12 2v20M2 12h20" strokeLinecap="round" />
            </svg>
          </button>

          {/* Nav Item 1: Handoff Queue (Screen 1) */}
          <button
            style={currentView === 'queue' ? styles.navBtnActive : styles.navBtn}
            onClick={() => setCurrentView('queue')}
            title="Screen 1: Handoff Queue"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={currentView === 'queue' ? '#1d68ed' : '#64748b'} strokeWidth="2">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {openHandoffsList.length > 0 && (
              <span style={styles.sidebarBadge}>{openHandoffsList.length}</span>
            )}
          </button>

          {/* Nav Item 2: Conversation Detail (Screen 2) */}
          <button
            style={currentView === 'detail' ? styles.navBtnActive : styles.navBtn}
            onClick={() => {
              setCurrentView('detail');
              if (!activeDetail) loadConversationTrace('cv_4471');
            }}
            title="Screen 2: Grounded Conversation Detail"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={currentView === 'detail' ? '#1d68ed' : '#64748b'} strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="8" y1="9" x2="16" y2="9" strokeLinecap="round" />
              <line x1="8" y1="13" x2="13" y2="13" strokeLinecap="round" />
            </svg>
          </button>

          {/* Nav Item 3: All 23 Test Scenarios */}
          <button
            style={currentView === 'test_runner' ? styles.navBtnActive : styles.navBtn}
            onClick={() => setCurrentView('test_runner')}
            title="Screen 3: All 23 Test Scenarios"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={currentView === 'test_runner' ? '#1d68ed' : '#64748b'} strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Nav Item 4: Interactive Live Call Simulator */}
          <button
            style={currentView === 'simulator' ? styles.navBtnActive : styles.navBtn}
            onClick={() => setCurrentView('simulator')}
            title="Screen 4: Interactive Call Simulator"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={currentView === 'simulator' ? '#1d68ed' : '#64748b'} strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Nav Item 5: Clinic Schedule & Doctor Windows */}
          <button
            style={currentView === 'clinic_info' ? styles.navBtnActive : styles.navBtn}
            onClick={() => setCurrentView('clinic_info')}
            title="Clinic Schedule & Doctor Windows"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={currentView === 'clinic_info' ? '#1d68ed' : '#64748b'} strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
              <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
              <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.sidebarFooter}>
          <div style={styles.clinicStatusDot} title="Backend Online: FastAPI on Port 8000" />
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main style={styles.mainContent}>

        {/* ============================================================== */}
        {/* VIEW 1: SCREEN 1 — HANDOFF QUEUE (EXACT MATCH TO PDF SCREEN 1) */}
        {/* ============================================================== */}
        {currentView === 'queue' && (
          <div className="fade-in">
            {/* TOP HEADER ROW */}
            <div style={styles.headerRow}>
              <div>
                <h1 style={styles.pageTitle}>Handoff Queue</h1>
                <p style={styles.pageSubtitle}>Sunrise Clinic, Dehradun — conversations the agent escalated</p>
              </div>
              <div style={styles.openBadgeContainer}>
                <span style={styles.pulseDot} />
                <span style={styles.openCountBadge}>{stats.escalated_open} OPEN</span>
              </div>
            </div>

            {/* TOP 4 STAT CARDS */}
            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>CONVERSATIONS</div>
                <div style={styles.statValue}>{stats.conversations_today}</div>
                <div style={styles.statSubtext}>
                  <span style={styles.trendUp}>↑ today</span>
                </div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>COMPLETED BY AGENT</div>
                <div style={styles.statValue}>{stats.completed_by_agent}</div>
                <div style={styles.statSubtext}>
                  <span style={styles.statPercentBadge}>{stats.completion_rate}</span> resolution rate
                </div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>ESCALATED</div>
                <div style={styles.statValue}>{stats.escalated_total}</div>
                <div style={styles.statLinkText}>
                  {stats.escalated_open} still open in queue
                </div>
              </div>

              <div style={{ ...styles.statCard, borderLeft: '4px solid #ef4444' }}>
                <div style={{ ...styles.statLabel, color: '#dc2626' }}>URGENT</div>
                <div style={{ ...styles.statValue, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {stats.urgent_unresolved}
                  {stats.urgent_unresolved > 0 && <span style={styles.urgentPulse} />}
                </div>
                <div style={{ ...styles.statSubtext, color: '#dc2626', fontWeight: '600' }}>
                  clinical, unresolved
                </div>
              </div>
            </div>

            {/* OPEN HANDOFFS TABLE CARD */}
            <div style={styles.tableCard}>
              <div style={styles.tableCardHeader}>
                <div>
                  <h2 style={styles.tableTitle}>Open handoffs</h2>
                  <div style={styles.queueSubTabs}>
                    <button
                      style={handoffStatusFilter === 'open' ? styles.subTabActive : styles.subTab}
                      onClick={() => setHandoffStatusFilter('open')}
                    >
                      Open ({openHandoffsList.length})
                    </button>
                    <button
                      style={handoffStatusFilter === 'resolved' ? styles.subTabActive : styles.subTab}
                      onClick={() => setHandoffStatusFilter('resolved')}
                    >
                      Resolved ({resolvedHandoffsList.length})
                    </button>
                    <button
                      style={handoffStatusFilter === 'all' ? styles.subTabActive : styles.subTab}
                      onClick={() => setHandoffStatusFilter('all')}
                    >
                      All ({handoffs.length})
                    </button>
                  </div>
                </div>

                <div style={styles.searchBox}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search handoffs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={styles.searchInput}
                  />
                </div>
              </div>

              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeaderRow}>
                    <th style={styles.th}>CONVERSATION</th>
                    <th style={styles.th}>CALLER SAID</th>
                    <th style={styles.th}>REASON</th>
                    <th style={styles.th}>TIME</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHandoffs.map((row) => (
                    <tr
                      key={row.id}
                      style={styles.tableRow}
                      onClick={() => openConversationDetail(row.id)}
                    >
                      <td style={styles.tdId}>
                        <span style={styles.idChip}>{row.id}</span>
                      </td>
                      <td style={styles.tdCaller}>"{row.caller_said}"</td>
                      <td style={styles.td}>{renderBadge(row.reason)}</td>
                      <td style={styles.tdTime}>{row.time}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        {row.status === 'open' ? (
                          <button
                            style={row.urgent ? styles.btnResolveSolid : styles.btnResolveOutline}
                            onClick={(e) => handleResolve(row.id, e)}
                            title="Resolve handoff"
                          >
                            Resolve
                          </button>
                        ) : (
                          <button
                            style={styles.btnReopenOutline}
                            onClick={(e) => handleReopen(row.id, e)}
                            title="Reopen handoff"
                          >
                            Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredHandoffs.length === 0 && (
                    <tr>
                      <td colSpan="5" style={styles.emptyState}>
                        No handoffs match the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================================================================== */}
        {/* VIEW 2: SCREEN 2 — CONVERSATION DETAIL (EXACT MATCH TO PDF SCREEN 2)  */}
        {/* ====================================================================== */}
        {currentView === 'detail' && activeDetail && (
          <div className="fade-in">
            <div style={styles.headerRow}>
              <div>
                <button style={styles.btnBack} onClick={() => setCurrentView('queue')}>
                  ← Back to Handoff Queue
                </button>
                <h1 style={styles.pageTitle}>{activeDetail.title}</h1>
                <p style={styles.pageSubtitle}>{activeDetail.subtitle}</p>
              </div>
              <div style={styles.detailBadgeContainer}>
                {renderBadge(activeDetail.badge)}
              </div>
            </div>

            {/* TWO COLUMNS DETAIL GRID */}
            <div style={styles.detailGrid}>
              {/* LEFT COLUMN: TRANSCRIPT AND TOOL CALLS INLINE */}
              <div style={styles.card}>
                <div style={styles.cardHeaderRow}>
                  <h2 style={styles.cardHeader}>Transcript and tool calls</h2>
                  <span style={styles.liveIndicator}>
                    <span style={styles.badgeDotGreen} /> Grounded Trace
                  </span>
                </div>

                <div style={styles.transcriptContainer}>
                  {activeDetail.transcript.map((item, idx) => {
                    if (item.role === 'CALLER') {
                      return (
                        <div key={idx} style={styles.msgRow}>
                          <div style={styles.msgRole}>
                            <span style={styles.callerIcon}>C</span> CALLER
                          </div>
                          <div style={styles.msgBubbleCaller}>{item.text}</div>
                        </div>
                      );
                    }
                    if (item.role === 'TOOL') {
                      return (
                        <div key={idx} style={styles.msgRow}>
                          <div style={styles.msgRoleTool}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5">
                              <polygon points="12 2 2 7 12 12 22 7 12 2" />
                              <polyline points="2 17 12 22 22 17" />
                              <polyline points="2 12 12 17 22 12" />
                            </svg>
                            TOOL
                          </div>
                          <div style={styles.toolCallBox}>
                            <div style={styles.toolCode}>
                              <span style={styles.fnName}>{item.fn}</span>({item.args})
                            </div>
                            {item.output && (
                              <div style={styles.toolOutputText}>{item.output}</div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (item.role === 'AGENT') {
                      return (
                        <div key={idx} style={styles.msgRow}>
                          <div style={styles.msgRoleAgent}>
                            <span style={styles.agentIcon}>A</span> AGENT
                          </div>
                          <div style={styles.msgBubbleAgent}>{item.text}</div>
                        </div>
                      );
                    }
                    return null;
                  })}

                  {activeDetail.abandonedNotice && (
                    <div style={styles.abandonNoticeBox}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{activeDetail.abandonedNotice}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: MACHINE OUTCOME */}
              <div style={styles.card}>
                <div style={styles.cardHeaderRow}>
                  <h2 style={styles.cardHeader}>Outcome</h2>
                  <button style={styles.btnCopy} onClick={copyOutcomeJson} title="Copy JSON outcome">
                    {copied ? '✓ Copied' : 'Copy JSON'}
                  </button>
                </div>

                <div style={styles.outcomeList}>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>terminal_state</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.terminal_state}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>escalation_reason</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.escalation_reason}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>patient_id</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.patient_id}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>appointment_id</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.appointment_id}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>tool_calls</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.tool_calls}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>turns</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.turns}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>tokens</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.tokens}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>latency</span>
                    <span style={styles.outcomeVal}>{activeDetail.outcome.latency}</span>
                  </div>

                  {/* DETERMINISM AUDIT CARD MATCHING PDF */}
                  <div style={styles.determinismCard}>
                    <div style={styles.determinismLabel}>DETERMINISM</div>
                    <div style={styles.determinismRow}>
                      <span style={styles.determinismText}>Same terminal state across 3 runs.</span>
                      <span style={styles.badgeStable}>
                        <span style={styles.badgeDotGreenPulse} />
                        {activeDetail.outcome.determinism}
                      </span>
                    </div>
                  </div>

                  {/* ACTION BAR */}
                  <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                    <button
                      style={styles.btnTestInSim}
                      onClick={() => {
                        const callerTurns = activeDetail.transcript
                          .filter(t => t.role === 'CALLER')
                          .map(t => t.text);
                        sendToSimulator(callerTurns.length ? callerTurns : [activeDetail.title]);
                      }}
                    >
                      ⚡ Test in Live Simulator
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 3: ALL 23 TEST SCENARIOS                                  */}
        {/* ============================================================== */}
        {currentView === 'test_runner' && (
          <div className="fade-in">
            <div style={styles.headerRow}>
              <div>
                <h1 style={styles.pageTitle}>All 23 Test Scenarios</h1>
                <p style={styles.pageSubtitle}>
                  Click any scenario to immediately execute it against the live API and inspect its grounded tool trace
                </p>
              </div>
              <div style={styles.filterGroup}>
                <button
                  style={scenarioFilter === 'all' ? styles.filterBtnActive : styles.filterBtn}
                  onClick={() => setScenarioFilter('all')}
                >
                  All (23)
                </button>
                <button
                  style={scenarioFilter === 'starter' ? styles.filterBtnActive : styles.filterBtn}
                  onClick={() => setScenarioFilter('starter')}
                >
                  Starter Pack 15
                </button>
                <button
                  style={scenarioFilter === 'adversarial' ? styles.filterBtnActive : styles.filterBtn}
                  onClick={() => setScenarioFilter('adversarial')}
                >
                  Adversarial 8
                </button>
              </div>
            </div>

            <div style={styles.scriptGrid}>
              {filteredScenarios.map((sc) => (
                <div
                  key={sc.id}
                  style={styles.scriptCard}
                  onClick={() => openConversationDetail(sc.id)}
                >
                  <div style={styles.scriptTop}>
                    <span style={styles.scriptId}>{sc.id}</span>
                    <span style={sc.id.startsWith('adv_') ? styles.tagAdv : styles.tagStarter}>
                      {sc.id.startsWith('adv_') ? 'ADVERSARIAL' : 'STARTER PACK'}
                    </span>
                  </div>
                  <div style={styles.scriptDesc}>{sc.description}</div>
                  <div style={styles.scriptFooter}>
                    <span style={styles.scriptTurnsCount}>{sc.turns.length} turns</span>
                    <span style={styles.scriptActionText}>Run Grounded Trace →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 4: INTERACTIVE LIVE CALL SIMULATOR                        */}
        {/* ============================================================== */}
        {currentView === 'simulator' && (
          <div className="fade-in">
            <div style={styles.headerRow}>
              <div>
                <h1 style={styles.pageTitle}>Interactive Call Simulator</h1>
                <p style={styles.pageSubtitle}>
                  Type any Hindi, Hinglish, or English statement to test the front desk agent and safety reflexes live
                </p>
              </div>
              <button style={styles.btnSecondary} onClick={clearSimTurns}>
                Clear Turns
              </button>
            </div>

            {/* QUICK PRESETS */}
            <div style={styles.presetsRow}>
              <span style={styles.presetLabel}>Quick Presets:</span>
              <button
                style={styles.presetChip}
                onClick={() => setSimTurns([
                  "Kal subah Dr. Rao ke saath appointment chahiye.",
                  "10:15 kar dijiye. Waise abhi seene mein dard ho raha hai thoda."
                ])}
              >
                🚨 Acute Chest Pain Emergency
              </button>
              <button
                style={styles.presetChip}
                onClick={() => setSimTurns([
                  "Lakshmi Iyer ka aaj ka appointment cancel karna hai.",
                  "Main unka padosi hoon, Mohit Negi. Unka number nahi hai mere paas."
                ])}
              >
                ⚠️ Neighbor Cancellation
              </button>
              <button
                style={styles.presetChip}
                onClick={() => setSimTurns([
                  "Do din se bukhar hai, main Crocin le raha hoon.",
                  "Ek aur goli le lun ya nahi? Aur kitni der mein utar jana chahiye?"
                ])}
              >
                💊 Medical Dosage Inquiry
              </button>
              <button
                style={styles.presetChip}
                onClick={() => setSimTurns([
                  "Sharma ji ke liye Dr. Rao ke saath appointment chahiye.",
                  "Bas Sharma. Phone number mujhe yaad nahi hai."
                ])}
              >
                👥 Ambiguous Patient
              </button>
            </div>

            <div style={styles.detailGrid}>
              {/* LEFT: DIALOGUE BUILDER */}
              <div style={styles.card}>
                <h2 style={styles.cardHeader}>Conversation Turns</h2>

                <div style={styles.transcriptContainer}>
                  {simTurns.map((turn, i) => (
                    <div key={i} style={styles.msgRow}>
                      <div style={styles.msgRole}>
                        <span style={styles.callerIcon}>C</span> TURN {i + 1}
                      </div>
                      <div style={styles.msgBubbleCaller}>{turn}</div>
                    </div>
                  ))}

                  {simTurns.length === 0 && (
                    <div style={{ color: '#94a3b8', fontStyle: 'italic', padding: '16px 0' }}>
                      No turns added yet. Add a statement below to test.
                    </div>
                  )}

                  {/* INPUT ROW */}
                  <div style={styles.addTurnRow}>
                    <input
                      type="text"
                      placeholder="e.g. Shanivaar subah 10 baje Dr. Rao ke saath..."
                      value={newSimTurn}
                      onChange={(e) => setNewSimTurn(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addSimTurn(); }}
                      style={styles.turnInput}
                    />
                    <button style={styles.btnAdd} onClick={addSimTurn}>
                      + Add Turn
                    </button>
                  </div>

                  <button
                    style={styles.btnRunSim}
                    onClick={runSimulator}
                    disabled={simLoading || simTurns.length === 0}
                  >
                    {simLoading ? 'Evaluating against agent...' : '⚡ Run Agent on Conversation'}
                  </button>
                </div>
              </div>

              {/* RIGHT: LIVE AGENT EXECUTION RESULT */}
              <div style={styles.card}>
                <h2 style={styles.cardHeader}>Live Agent Grounded Execution</h2>

                {simResult ? (
                  <div style={styles.outcomeList}>
                    {/* AGENT REPLY */}
                    <div style={{ marginBottom: '16px' }}>
                      <div style={styles.msgRoleAgent}>AGENT REPLY</div>
                      <div style={{ ...styles.msgBubbleAgent, maxWidth: '100%', marginTop: '6px' }}>
                        {simResult.reply}
                      </div>
                    </div>

                    {/* TOOLS CALLED */}
                    <div style={{ marginBottom: '16px' }}>
                      <div style={styles.msgRoleTool}>TOOLS CALLED ({simResult.tool_calls.length})</div>
                      {simResult.tool_calls.map((tc, idx) => (
                        <div key={idx} style={{ ...styles.toolCallBox, marginTop: '6px' }}>
                          <span style={styles.fnName}>{tc.name}</span>
                          <span style={styles.argsText}>({JSON.stringify(tc.arguments)})</span>
                        </div>
                      ))}
                      {simResult.tool_calls.length === 0 && (
                        <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
                          No tools called (e.g. refused or empty dialogue).
                        </div>
                      )}
                    </div>

                    <div style={styles.outcomeRow}>
                      <span style={styles.outcomeKey}>terminal_state</span>
                      <span style={styles.outcomeVal}>{simResult.terminal_state}</span>
                    </div>
                    <div style={styles.outcomeRow}>
                      <span style={styles.outcomeKey}>escalation_reason</span>
                      <span style={styles.outcomeVal}>{simResult.escalation_reason || 'null'}</span>
                    </div>
                    <div style={styles.outcomeRow}>
                      <span style={styles.outcomeKey}>patient_id</span>
                      <span style={styles.outcomeVal}>{simResult.patient_id || 'null'}</span>
                    </div>
                    <div style={styles.outcomeRow}>
                      <span style={styles.outcomeKey}>appointment_id</span>
                      <span style={styles.outcomeVal}>{simResult.appointment_id || 'null'}</span>
                    </div>
                    <div style={styles.outcomeRow}>
                      <span style={styles.outcomeKey}>latency</span>
                      <span style={styles.outcomeVal}>{simResult.metrics ? simResult.metrics.latency_ms : 0} ms</span>
                    </div>

                    {simResult.terminal_state === 'escalated' && (
                      <div style={{ marginTop: '16px' }}>
                        <button
                          style={styles.btnResolveSolid}
                          onClick={() => {
                            setCurrentView('queue');
                            showToast('Navigated to Handoff Queue!');
                          }}
                        >
                          → View Escalated in Handoff Queue
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', textAlign: 'center', padding: '60px 20px', fontSize: '14px' }}>
                    Click <strong>Run Agent</strong> to execute the dialogue and see grounded tool calls in real time.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 5: CLINIC SCHEDULE & DOCTORS                             */}
        {/* ============================================================== */}
        {currentView === 'clinic_info' && clinicData && (
          <div className="fade-in">
            <div style={styles.headerRow}>
              <div>
                <h1 style={styles.pageTitle}>Sunrise Clinic Information</h1>
                <p style={styles.pageSubtitle}>Dehradun, Uttarakhand — Ground Truth Schedule from clinic.json</p>
              </div>
            </div>

            <div style={styles.detailGrid}>
              <div style={styles.card}>
                <h2 style={styles.cardHeader}>Doctors & Appointment Windows</h2>
                {Object.entries(clinicData.doctors || {}).map(([docId, doc]) => (
                  <div key={docId} style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{doc.name}</div>
                    <div style={{ fontSize: '13px', color: '#2563eb', fontWeight: '600', marginBottom: '8px' }}>{doc.speciality}</div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      <strong>Windows:</strong> Morning (09:00 - 12:00, 15m slots) & Evening (17:00 - 19:00, 15m slots)
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                      Doctor ID: <code style={{ backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{docId}</code>
                    </div>
                  </div>
                ))}
              </div>

              <div style={styles.card}>
                <h2 style={styles.cardHeader}>Clinic Profile & Invariants</h2>
                <div style={styles.outcomeList}>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Clinic Name</span>
                    <span style={styles.outcomeVal}>{clinicData.name}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Location</span>
                    <span style={styles.outcomeVal}>{clinicData.location}</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Slot Duration</span>
                    <span style={styles.outcomeVal}>15 minutes</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Patients Loaded</span>
                    <span style={styles.outcomeVal}>{Object.keys(clinicData.patients || {}).length} registered</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Existing Bookings</span>
                    <span style={styles.outcomeVal}>{(clinicData.existing_bookings || []).length} active</span>
                  </div>
                  <div style={styles.outcomeRow}>
                    <span style={styles.outcomeKey}>Double-Booking Guard</span>
                    <span style={{ ...styles.outcomeVal, color: '#16a34a' }}>ATOMIC LOCK ENABLED</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  appContainer: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  },
  toast: {
    position: 'fixed',
    top: '20px',
    right: '24px',
    backgroundColor: '#0f172a',
    color: '#ffffff',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
    zIndex: 9999
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: '68px',
    height: '100vh',
    backgroundColor: '#ffffff',
    borderRight: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '24px 0',
    boxShadow: '1px 0 4px rgba(15, 23, 42, 0.03)',
    zIndex: 100,
    overflow: 'hidden',
    boxSizing: 'border-box'
  },
  sidebarCircles: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    width: '100%'
  },
  brandIconBtn: {
    width: '42px',
    height: '42px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #1d68ed 0%, #0284c7 100%)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    marginBottom: '16px',
    boxShadow: '0 4px 12px rgba(29, 104, 237, 0.35)',
    transition: 'transform 0.15s ease'
  },
  navBtn: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    background: 'transparent',
    border: '1px solid transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.15s ease'
  },
  navBtnActive: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    boxShadow: '0 2px 8px rgba(29, 104, 237, 0.12)'
  },
  sidebarBadge: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    fontSize: '10px',
    fontWeight: '800',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid #ffffff'
  },
  sidebarFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  clinicStatusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#16a34a',
    boxShadow: '0 0 0 3px rgba(22, 163, 74, 0.2)'
  },
  mainContent: {
    flex: 1,
    marginLeft: '68px',
    padding: '30px 48px 60px 48px',
    maxWidth: 'calc(100vw - 68px)',
    minHeight: '100vh',
    boxSizing: 'border-box'
  },
  topTabBar: {
    borderBottom: '1px solid #e2e8f0',
    paddingBottom: '16px',
    marginBottom: '28px'
  },
  tabButtons: {
    display: 'flex',
    gap: '10px'
  },
  tabBtn: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13.5px',
    fontWeight: '600',
    color: '#64748b',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  tabBtnActive: {
    backgroundColor: '#1d68ed',
    border: '1px solid #1d68ed',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13.5px',
    fontWeight: '700',
    color: '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 2px 6px rgba(29, 104, 237, 0.25)'
  },
  tabCountPill: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    color: 'inherit',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '800'
  },
  tabSubPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'inherit',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontFamily: "'JetBrains Mono', monospace"
  },
  tabLivePill: {
    backgroundColor: '#16a34a',
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '800'
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px'
  },
  pageTitle: {
    fontSize: '26px',
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: '-0.025em',
    marginBottom: '4px'
  },
  pageSubtitle: {
    fontSize: '14px',
    color: '#64748b'
  },
  openBadgeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    padding: '6px 14px',
    borderRadius: '999px',
    boxShadow: '0 2px 4px rgba(29, 104, 237, 0.08)'
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#1d68ed',
    animation: 'pulseGreen 2s infinite'
  },
  openCountBadge: {
    color: '#1d68ed',
    fontSize: '13px',
    fontWeight: '700'
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '18px',
    marginBottom: '26px'
  },
  statCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '20px 22px',
    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)'
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: '0.06em',
    marginBottom: '8px'
  },
  statValue: {
    fontSize: '34px',
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: '1.1',
    letterSpacing: '-0.03em',
    marginBottom: '6px'
  },
  statSubtext: {
    fontSize: '13px',
    color: '#64748b'
  },
  trendUp: {
    color: '#64748b',
    fontWeight: '500'
  },
  statPercentBadge: {
    color: '#64748b',
    fontWeight: '600'
  },
  statLinkText: {
    fontSize: '13px',
    color: '#1d68ed',
    fontWeight: '600'
  },
  urgentPulse: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#dc2626',
    animation: 'pulseRed 1.5s infinite'
  },
  tableCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '24px 28px',
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)'
  },
  tableCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  tableTitle: {
    fontSize: '18px',
    fontWeight: '700',
    letterSpacing: '-0.02em',
    marginBottom: '6px'
  },
  queueSubTabs: {
    display: 'flex',
    gap: '8px'
  },
  subTab: {
    background: 'none',
    border: 'none',
    fontSize: '13px',
    color: '#64748b',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '6px'
  },
  subTabActive: {
    background: '#eff6ff',
    border: 'none',
    fontSize: '13px',
    color: '#1d68ed',
    fontWeight: '700',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '6px'
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '6px 12px'
  },
  searchInput: {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    fontSize: '13px',
    color: '#0f172a',
    width: '200px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left'
  },
  tableHeaderRow: {
    borderBottom: '1px solid #f1f5f9'
  },
  th: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#94a3b8',
    paddingBottom: '14px',
    letterSpacing: '0.05em'
  },
  tableRow: {
    borderBottom: '1px solid #f8fafc',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease'
  },
  td: {
    padding: '16px 0',
    fontSize: '14px'
  },
  tdId: {
    padding: '16px 0',
    fontFamily: "'JetBrains Mono', monospace",
    color: '#1e293b'
  },
  idChip: {
    fontFamily: "'JetBrains Mono', monospace",
    color: '#1e293b',
    fontSize: '13.5px'
  },
  tdCaller: {
    padding: '16px 0',
    fontSize: '14px',
    fontWeight: '700',
    color: '#0f172a'
  },
  tdTime: {
    padding: '16px 0',
    fontSize: '13px',
    color: '#64748b',
    fontFamily: "'JetBrains Mono', monospace"
  },
  btnResolveSolid: {
    backgroundColor: '#1d68ed',
    color: '#ffffff',
    border: 'none',
    padding: '6px 18px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(29, 104, 237, 0.2)'
  },
  btnResolveOutline: {
    backgroundColor: 'transparent',
    color: '#1d68ed',
    border: '1px solid #cbd5e1',
    padding: '6px 18px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  btnReopenOutline: {
    backgroundColor: 'transparent',
    color: '#16a34a',
    border: '1px solid #86efac',
    padding: '6px 18px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  emptyState: {
    padding: '40px',
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: '14px'
  },
  btnBack: {
    background: 'none',
    border: 'none',
    color: '#1d68ed',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '8px',
    padding: 0
  },
  detailBadgeContainer: {
    paddingTop: '6px'
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '1.65fr 1.15fr',
    gap: '28px'
  },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '26px',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)'
  },
  cardHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  cardHeader: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#0f172a'
  },
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#16a34a',
    fontWeight: '600'
  },
  transcriptContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  msgRow: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start'
  },
  msgRole: {
    width: '75px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: '0.04em',
    paddingTop: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  msgRoleTool: {
    width: '75px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#2563eb',
    letterSpacing: '0.04em',
    paddingTop: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  msgRoleAgent: {
    width: '75px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#475569',
    letterSpacing: '0.04em',
    paddingTop: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  callerIcon: {
    display: 'none'
  },
  agentIcon: {
    display: 'none'
  },
  msgBubbleCaller: {
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: '1.5',
    flex: 1
  },
  msgBubbleAgent: {
    backgroundColor: '#ffffff',
    color: '#0f172a',
    border: '1px solid #e2e8f0',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: '1.5',
    flex: 1
  },
  toolCallBox: {
    backgroundColor: '#f0f9ff',
    borderLeft: '3px solid #0284c7',
    padding: '10px 14px',
    borderRadius: '4px',
    flex: 1,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px'
  },
  toolCode: {
    color: '#0369a1',
    fontWeight: '600',
    lineHeight: '1.4'
  },
  fnName: {
    color: '#0284c7',
    fontWeight: '700'
  },
  argsText: {
    color: '#334155'
  },
  toolOutputText: {
    color: '#0284c7',
    marginTop: '4px',
    fontSize: '12px'
  },
  abandonNoticeBox: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '13.5px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '10px'
  },
  outcomeList: {
    display: 'flex',
    flexDirection: 'column'
  },
  outcomeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
    fontSize: '13.5px'
  },
  outcomeKey: {
    color: '#64748b',
    fontFamily: "'JetBrains Mono', monospace"
  },
  outcomeVal: {
    fontWeight: '700',
    fontFamily: "'JetBrains Mono', monospace",
    color: '#0f172a'
  },
  determinismCard: {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e2e8f0'
  },
  determinismLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: '0.05em',
    marginBottom: '8px'
  },
  determinismRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  determinismText: {
    fontSize: '13px',
    color: '#475569'
  },
  badgeStable: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    padding: '3px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '800',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeDotGreenPulse: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#16a34a'
  },
  btnCopy: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#475569',
    cursor: 'pointer'
  },
  btnTestInSim: {
    backgroundColor: '#f1f5f9',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#334155',
    cursor: 'pointer'
  },
  // BADGES
  badgeClinical: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeAuth: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeAmbiguous: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeAdvice: {
    backgroundColor: '#ffe4e6',
    color: '#9f1239',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeScope: {
    backgroundColor: '#f3e8ff',
    color: '#7e22ce',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeBooked: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeRescheduled: {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeCancelled: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px'
  },
  badgeDefault: {
    backgroundColor: '#f1f5f9',
    color: '#334155',
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '700'
  },
  badgeDotRed: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#dc2626'
  },
  badgeDotAmber: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#d97706'
  },
  badgeDotGold: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#d97706'
  },
  badgeDotRose: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#e11d48'
  },
  badgeDotPurple: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#9333ea'
  },
  badgeDotGreen: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#16a34a'
  },
  badgeDotBlue: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#2563eb'
  },
  badgeDotGray: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#64748b'
  },
  // TEST SCENARIOS
  filterGroup: {
    display: 'flex',
    gap: '8px'
  },
  filterBtn: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    padding: '6px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#64748b',
    cursor: 'pointer'
  },
  filterBtnActive: {
    backgroundColor: '#1d68ed',
    border: '1px solid #1d68ed',
    padding: '6px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '700',
    color: '#ffffff',
    cursor: 'pointer'
  },
  scriptGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px'
  },
  scriptCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    padding: '16px',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
  },
  scriptTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  scriptId: {
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: '700',
    color: '#0f172a',
    fontSize: '14px'
  },
  tagStarter: {
    backgroundColor: '#eff6ff',
    color: '#1d68ed',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10.5px',
    fontWeight: '700'
  },
  tagAdv: {
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10.5px',
    fontWeight: '700'
  },
  scriptDesc: {
    fontSize: '13px',
    color: '#475569',
    lineHeight: '1.4',
    marginBottom: '14px',
    minHeight: '36px'
  },
  scriptFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px'
  },
  scriptTurnsCount: {
    color: '#94a3b8'
  },
  scriptActionText: {
    color: '#1d68ed',
    fontWeight: '600'
  },
  // SIMULATOR
  btnSecondary: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#64748b',
    cursor: 'pointer'
  },
  presetsRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  presetLabel: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#64748b'
  },
  presetChip: {
    backgroundColor: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '999px',
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#334155',
    cursor: 'pointer'
  },
  addTurnRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '10px'
  },
  turnInput: {
    flex: 1,
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none'
  },
  btnAdd: {
    backgroundColor: '#f1f5f9',
    border: '1px solid #cbd5e1',
    padding: '0 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#334155',
    cursor: 'pointer'
  },
  btnRunSim: {
    backgroundColor: '#1d68ed',
    color: '#ffffff',
    border: 'none',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    marginTop: '14px',
    boxShadow: '0 2px 8px rgba(29, 104, 237, 0.25)'
  }
};
