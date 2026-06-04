import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import './App.css'

const RELATIVE_THRESHOLD = 2 * 60 * 1000

function getTemperature(device) {
  const keys = ['temperature', 'temp', 'temperature_c', 'temperatureC', 'temperature_celsius']
  for (const key of keys) {
    if (device?.[key] != null) {
      return device[key]
    }
  }
  return null
}

function getRssi(device) {
  const keys = ['rssi', 'wifi_rssi', 'signal', 'wifiSignal']
  for (const key of keys) {
    if (device?.[key] != null) {
      return device[key]
    }
  }
  return null
}

function parseTimestamp(value) {
  if (value == null) {
    return null
  }

  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000)
  }

  if (typeof value === 'string') {
    // Detectar formato SQLite: "YYYY-MM-DD HH:mm:ss" (UTC)
    const sqliteMatch = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
    if (sqliteMatch) {
      // Convertir a ISO 8601 con Z (UTC) para parsing correcto
      const iso = value.replace(' ', 'T') + 'Z'
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? null : date
    }
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseLastSeen(device) {
  return parseTimestamp(
    device.last_seen ?? device.lastSeen ?? device.last_seen_at ?? device.lastSeenAt,
  )
}

function formatTimestamp(value) {
  if (!value || !(value instanceof Date)) return 'No disponible'
  if (Number.isNaN(value.getTime())) return 'No disponible'
  
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const year = value.getFullYear()
  return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`
}

function getDeviceId(device, index) {
  return device.device_id ?? device.id ?? device.deviceId ?? `device-${index + 1}`
}

function parseDeviceList(data) {
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.devices)
    ? data.devices
    : []
}

function parseTelemetryList(data) {
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.telemetry)
    ? data.telemetry
    : []
}

function parseAlertList(data) {
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.alerts)
    ? data.alerts
    : []
}

function getThermalState(temperature) {
  if (temperature == null || Number.isNaN(Number(temperature))) {
    return { label: 'SIN DATOS', key: 'unknown' }
  }

  const value = Number(temperature)
  if (value < 30) {
    return { label: '🟢 NORMAL', key: 'normal' }
  }

  if (value < 35) {
    return { label: '🟡 ADVERTENCIA', key: 'warning' }
  }

  return { label: '🔴 CRÍTICA', key: 'critical' }
}

function isOffline(lastSeen, onlineFlag) {
  if (lastSeen) {
    return Date.now() - lastSeen.getTime() > RELATIVE_THRESHOLD
  }
  return onlineFlag === false
}

function App() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [telemetry, setTelemetry] = useState([])
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState(null)
  const [activeAlerts, setActiveAlerts] = useState([])
  const [historyAlerts, setHistoryAlerts] = useState([])
  const [activeAlertsError, setActiveAlertsError] = useState(null)
  const [historyAlertsError, setHistoryAlertsError] = useState(null)
  const [showAlertHistory, setShowAlertHistory] = useState(false)

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json()
  }

  async function loadDevices(signal) {
    const data = await fetchJson('/api/v1/devices', signal)
    setDevices(parseDeviceList(data))
    setError(null)
    setLastUpdated(new Date())
  }

  async function loadTelemetry(deviceId, signal) {
    const data = await fetchJson(
      `/api/v1/telemetry?deviceId=${encodeURIComponent(deviceId)}&limit=20`,
      signal,
    )
    setTelemetry(parseTelemetryList(data))
    setTelemetryError(null)
  }

  async function loadActiveAlerts(signal) {
    const data = await fetchJson('/api/v1/alerts/active', signal)
    setActiveAlerts(parseAlertList(data))
    setActiveAlertsError(null)
  }

  async function loadAlertHistory(signal) {
    const data = await fetchJson('/api/v1/alerts', signal)
    setHistoryAlerts(parseAlertList(data))
    setHistoryAlertsError(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    const refreshInterval = 10000

    async function execute() {
      try {
        await loadDevices(controller.signal)
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Error al cargar dispositivos')
        }
      }

      try {
        await loadActiveAlerts(controller.signal)
      } catch (err) {
        if (err.name !== 'AbortError') {
          setActiveAlertsError(err.message || 'Error al cargar alertas activas')
        }
      }

      try {
        await loadAlertHistory(controller.signal)
      } catch (err) {
        if (err.name !== 'AbortError') {
          setHistoryAlertsError(err.message || 'Error al cargar el historial de alertas')
        }
      }

      if (selectedDeviceId) {
        try {
          setTelemetryLoading(true)
          await loadTelemetry(selectedDeviceId, controller.signal)
        } catch (err) {
          if (err.name !== 'AbortError') {
            setTelemetryError(err.message || 'Error al cargar telemetría')
          }
        } finally {
          setTelemetryLoading(false)
        }
      } else {
        setTelemetry([])
        setTelemetryError(null)
        setTelemetryLoading(false)
      }

      setLoading(false)
    }

    setLoading(true)
    execute()
    const intervalId = setInterval(execute, refreshInterval)

    return () => {
      controller.abort()
      clearInterval(intervalId)
    }
  }, [selectedDeviceId])

  const selectedDevice = devices.find((device, index) => getDeviceId(device, index) === selectedDeviceId)
  const selectedDeviceTemperature = selectedDevice ? getTemperature(selectedDevice) : null

  const handleDeviceSelection = (deviceId) => {
    setSelectedDeviceId((currentId) => (currentId === deviceId ? null : deviceId))
  }

  useEffect(() => {
    if (!selectedDeviceId) {
      setShowAlertHistory(false)
    }
  }, [selectedDeviceId])

  const activeAlertsList = activeAlerts.map((alert, index) => {
    const severity = String(alert.severity ?? 'unknown').toLowerCase()
    const key = severity === 'critical' || severity === 'warning' ? severity : 'default'
    const deviceId = alert.device_id ?? alert.deviceId ?? alert.device ?? `device-${index + 1}`

    return {
      id: alert.id ?? `${deviceId}-${index}`,
      deviceId,
      severity: key,
      icon: severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '⚪',
      message: alert.message ?? 'Alerta sin descripción',
      createdAt: alert.created_at ?? alert.createdAt ?? alert.timestamp ?? null,
    }
  })
  const alertHistoryList = historyAlerts
    .map((alert, index) => {
      const severity = String(alert.severity ?? 'unknown').toLowerCase()
      const key = severity === 'critical' || severity === 'warning' ? severity : 'default'
      const deviceId = alert.device_id ?? alert.deviceId ?? alert.device ?? `device-${index + 1}`

      return {
        id: alert.id ?? `${deviceId}-${index}`,
        date: alert.created_at ?? alert.createdAt ?? alert.timestamp ?? null,
        deviceId,
        severity: key,
        message: alert.message ?? 'Alerta sin descripción',
      }
    })
    .sort((a, b) => {
      const dateA = parseTimestamp(a.date)?.getTime() ?? 0
      const dateB = parseTimestamp(b.date)?.getTime() ?? 0
      return dateB - dateA
    })

  const selectedDeviceAlertHistory = selectedDevice
    ? alertHistoryList.filter((alert) => alert.deviceId === selectedDeviceId)
    : []

  const validTemperatures = telemetry
    .map((item) => Number(getTemperature(item)))
    .filter((value) => typeof value === 'number' && !Number.isNaN(value))

  const temperatureCount = validTemperatures.length
  const currentTemperature = temperatureCount > 0 ? validTemperatures[0] : null
  const minTemperature = temperatureCount > 0 ? Math.min(...validTemperatures) : null
  const maxTemperature = temperatureCount > 0 ? Math.max(...validTemperatures) : null
  const averageTemperature =
    temperatureCount > 0 ? validTemperatures.reduce((sum, value) => sum + value, 0) / temperatureCount : null

  const chartData = telemetry
    .map((item) => {
      const timestamp = parseTimestamp(
        item.received_at ?? item.receivedAt ?? item.timestamp ?? item.time,
      )
      const temperature = getTemperature(item)
      if (!timestamp || temperature == null) {
        return null
      }
      return {
        time: formatTimestamp(timestamp),
        temperature,
      }
    })
    .filter(Boolean)

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">ColdWatch</p>
          <h1>Dispositivos y temperaturas</h1>
          <p className="hero-copy">
            Dashboard limpio para ver estado, temperatura y conexión WiFi.
          </p>
          {lastUpdated && (
            <p className="update-time">Última actualización: {formatTimestamp(lastUpdated)}</p>
          )}
        </div>
        <div className="status-pill">
          {loading ? 'Cargando...' : error ? 'Error' : `${devices.length} dispositivos`}
        </div>
      </header>

      <section className="alerts-section">
        <div className="alerts-header">
          <div>
            <h2>Alertas activas</h2>
            <p className="alerts-note">
              {activeAlertsList.length > 0
                ? `${activeAlertsList.length} alerta${activeAlertsList.length > 1 ? 's' : ''} activa${activeAlertsList.length > 1 ? 's' : ''}`
                : 'Sistema estable por el momento.'}
            </p>
          </div>
        </div>
        {activeAlertsError && <div className="notice error">{activeAlertsError}</div>}
        <div className="alerts-list">
          {activeAlertsList.length === 0 ? (
            <div className="notice success">✅ No hay alertas activas</div>
          ) : (
            activeAlertsList.map((alert) => (
              <div key={alert.id} className={`alert-item ${alert.severity}`}>
                <span className="alert-icon">{alert.icon}</span>
                <div>
                  <p className="alert-message">
                    <strong>{alert.deviceId}</strong> - {alert.message}
                  </p>
                  <p className="alert-meta">
                    {formatTimestamp(parseTimestamp(alert.createdAt))}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="devices-section">
        {error && <div className="notice error">{error}</div>}

        {loading ? (
          <div className="notice">Buscando dispositivos...</div>
        ) : devices.length === 0 ? (
          <div className="notice">No se encontró ningún dispositivo.</div>
        ) : (
          <div className="device-grid">
            {devices.map((device, index) => {
              const temperature = getTemperature(device)
              const rssi = getRssi(device)
              const lastSeen = parseLastSeen(device)
              const statusOnline = device.online ?? device.isOnline
              const offline = isOffline(lastSeen, statusOnline)
              const status = lastSeen
                ? offline
                  ? 'Offline'
                  : 'Online'
                : statusOnline != null
                ? statusOnline
                  ? 'Online'
                  : 'Offline'
                : 'Desconocido'
              const statusClass = status === 'Online' ? 'online' : status === 'Offline' ? 'offline' : 'unknown'
              const deviceId = getDeviceId(device, index)
              const title = device.device_id ?? deviceId
              const subtitle = device.name ?? device.label ?? null
              const isSelected = selectedDeviceId === deviceId
              const thermalState = getThermalState(temperature)

              return (
                <article
                  className={`device-card ${thermalState.key}${isSelected ? ' selected' : ''}`}
                  key={deviceId}
                  tabIndex={0}
                  role="button"
                  onClick={() => handleDeviceSelection(deviceId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleDeviceSelection(deviceId)
                    }
                  }}
                >
                  <div className="device-heading">
                    <div>
                      <p className="device-name">{title}</p>
                      {subtitle && <p className="device-subtitle">{subtitle}</p>}
                    </div>
                    <div className="device-tags">
                      <span className={`device-badge ${statusClass}`}>{status}</span>
                      <span className={`device-alert-badge ${thermalState.key}`}>{thermalState.label}</span>
                    </div>
                  </div>

                  <div className="device-summary">
                    <div className="stat-block">
                      <span className="stat-label">Temperatura</span>
                      <strong className="stat-value">
                        {temperature != null ? `${temperature}°C` : 'N/D'}
                      </strong>
                    </div>
                    <div className="stat-block">
                      <span className="stat-label">RSSI WiFi</span>
                      <strong className="stat-value">
                        {rssi != null ? `${rssi} dBm` : 'N/D'}
                      </strong>
                    </div>
                  </div>

                  <dl className="device-meta">
                    <div>
                      <dt>Última conexión</dt>
                      <dd>{formatTimestamp(lastSeen)}</dd>
                    </div>
                    {device.model && (
                      <div>
                        <dt>Modelo</dt>
                        <dd>{device.model}</dd>
                      </div>
                    )}
                    {device.location && (
                      <div>
                        <dt>Ubicación</dt>
                        <dd>{device.location}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="device-detail-section">
        <div className="detail-header">
          <div>
            <h2>Detalle de dispositivo</h2>
            <p className="detail-note">
              {selectedDevice
                ? `Detalles de ${selectedDevice.device_id ?? selectedDevice.id ?? selectedDevice.deviceId}`
                : 'Selecciona un dispositivo para ver su detalle.'}
            </p>
          </div>
        </div>

        {!selectedDevice ? (
          <div className="notice">Selecciona un dispositivo para ver su detalle.</div>
        ) : (
          <div className="telemetry-panel">
            <div className="detail-panel-top">
              <div>
                <p className="detail-device-name">{selectedDevice.device_id ?? selectedDevice.id ?? selectedDevice.deviceId}</p>
                <p className="detail-device-meta">
                  Temperatura actual: {selectedDeviceTemperature != null ? `${selectedDeviceTemperature}°C` : 'N/D'}
                </p>
              </div>
              <div className="detail-device-status">
                {selectedDevice.model && <span>{selectedDevice.model}</span>}
              </div>
            </div>

            {telemetryError && <div className="notice error">{telemetryError}</div>}
            {telemetryLoading && <div className="notice">Cargando telemetría...</div>}

            {!telemetryLoading && !telemetryError && (
              <>
                <div className="telemetry-stats-grid">
                  <div className="stat-card">
                    <span className="stat-label">Temperatura actual</span>
                    <strong className="stat-value">
                      {currentTemperature != null ? `${currentTemperature.toFixed(1)}°C` : 'N/D'}
                    </strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Mínima</span>
                    <strong className="stat-value">
                      {minTemperature != null ? `${minTemperature.toFixed(1)}°C` : 'N/D'}
                    </strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Máxima</span>
                    <strong className="stat-value">
                      {maxTemperature != null ? `${maxTemperature.toFixed(1)}°C` : 'N/D'}
                    </strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Promedio</span>
                    <strong className="stat-value">
                      {averageTemperature != null ? `${averageTemperature.toFixed(1)}°C` : 'N/D'}
                    </strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">Lecturas</span>
                    <strong className="stat-value">{temperatureCount}</strong>
                  </div>
                </div>
                <div className="telemetry-chart-panel">
                  <div className="chart-header">
                    <h3>Evolución de temperatura</h3>
                  </div>
                  {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: '#475569', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ stroke: '#8b5cf6', strokeWidth: 2 }} formatter={(value) => [`${value}°C`, 'Temperatura']} />
                        <Line type="monotone" dataKey="temperature" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="notice">No hay datos suficientes para graficar la temperatura.</div>
                  )}
                </div>
                <div className="telemetry-table">
                  <div className="telemetry-row telemetry-row-header">
                    <span>Recibido</span>
                    <span>Temperatura</span>
                    <span>RSSI WiFi</span>
                  </div>

                  {telemetry.length > 0 ? (
                    telemetry.map((item, index) => {
                      const timestamp = parseTimestamp(
                        item.received_at ?? item.receivedAt ?? item.timestamp ?? item.time,
                      )
                      const temperature = getTemperature(item)
                      const rssi = getRssi(item)

                      return (
                        <div className="telemetry-row" key={item.id ?? item.record_id ?? index}>
                          <span>{formatTimestamp(timestamp)}</span>
                          <span>{temperature != null ? `${temperature}°C` : 'N/D'}</span>
                          <span>{rssi != null ? `${rssi} dBm` : 'N/D'}</span>
                        </div>
                      )
                    })
                  ) : (
                    <div className="notice">No hay lecturas recientes para este dispositivo.</div>
                  )}
                </div>
              </>
            )}

            <div className="alerts-history-collapse">
              <button
                className="collapse-toggle"
                type="button"
                onClick={() => setShowAlertHistory((prev) => !prev)}
              >
                <span>{showAlertHistory ? '▼' : '▶'}</span> Historial de alertas
              </button>
              {showAlertHistory && (
                <>
                  {historyAlertsError && <div className="notice error">{historyAlertsError}</div>}
                  <div className="alerts-history-table-wrapper">
                    {selectedDeviceAlertHistory.length === 0 ? (
                      <div className="notice">No hay alertas registradas para este dispositivo.</div>
                    ) : (
                      <table className="alerts-history-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Dispositivo</th>
                            <th>Severidad</th>
                            <th>Mensaje</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDeviceAlertHistory.map((alert) => (
                            <tr key={alert.id} className={`alert-history-row ${alert.severity}`}>
                              <td>{formatTimestamp(parseTimestamp(alert.date))}</td>
                              <td>{alert.deviceId}</td>
                              <td>{alert.severity.toUpperCase()}</td>
                              <td>{alert.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
