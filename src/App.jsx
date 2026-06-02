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

  useEffect(() => {
    const controller = new AbortController()
    const refreshInterval = 10000

    async function execute() {
      try {
        await loadDevices(controller.signal)
        if (selectedDeviceId) {
          await loadTelemetry(selectedDeviceId, controller.signal)
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Error al cargar dispositivos')
        }
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    execute()
    const intervalId = setInterval(execute, refreshInterval)

    return () => {
      controller.abort()
      clearInterval(intervalId)
    }
  }, [selectedDeviceId])

  useEffect(() => {
    const controller = new AbortController()

    if (!selectedDeviceId) {
      setTelemetry([])
      setTelemetryError(null)
      setTelemetryLoading(false)
      return () => {}
    }

    async function executeTelemetry() {
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
    }

    executeTelemetry()
    return () => controller.abort()
  }, [selectedDeviceId])

  const selectedDevice = devices.find((device, index) => getDeviceId(device, index) === selectedDeviceId)
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

              return (
                <article
                  className={`device-card${isSelected ? ' selected' : ''}`}
                  key={deviceId}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelectedDeviceId(deviceId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedDeviceId(deviceId)
                    }
                  }}
                >
                  <div className="device-heading">
                    <div>
                      <p className="device-name">{title}</p>
                      {subtitle && <p className="device-subtitle">{subtitle}</p>}
                    </div>
                    <span className={`device-badge ${statusClass}`}>{status}</span>
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

      <section className="telemetry-panel">
        <div className="telemetry-header">
          <div>
            <h2>Histórico de telemetría</h2>
            <p className="telemetry-note">
              {selectedDevice
                ? `Últimas 20 lecturas de ${selectedDevice.device_id ?? selectedDevice.id ?? selectedDevice.deviceId}`
                : 'Haz clic en una tarjeta para ver las lecturas recientes de ese dispositivo.'}
            </p>
          </div>
        </div>

        {selectedDevice && telemetryError && (
          <div className="notice error">{telemetryError}</div>
        )}

        {selectedDevice && telemetryLoading && (
          <div className="notice">Cargando telemetría...</div>
        )}

        {selectedDevice && !telemetryLoading && !telemetryError && (
          <>
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
      </section>
    </main>
  )
}

export default App
