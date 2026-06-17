import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || ''

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)

const request = async (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token')
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong')
  }
  return data
}

const App = () => {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setLoading(false)
      return
    }

    request('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('token')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <main className="page-shell">Loading...</main>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage user={user} setUser={setUser} />} />
        <Route path="/listings" element={<ListingsPage user={user} />} />
        <Route path="/listings/:id" element={<ListingDetailPage user={user} />} />
        <Route path="/compare" element={<ComparePage user={user} />} />
        <Route path="/login" element={<LoginPage setUser={setUser} />} />
        <Route path="/register" element={<RegisterPage setUser={setUser} />} />
        <Route path="/sell/new" element={<CreateListingPage user={user} />} />
      </Routes>
    </BrowserRouter>
  )
}

function HomePage({ user, setUser }: { user: any; setUser: (value: any) => void }) {
  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
    navigate('/')
  }

  return (
    <main className="page-shell">
      <header className="top-nav">
        <div>
          <Link to="/" className="brand">VerifiedRide</Link>
        </div>
        <nav className="nav-links">
          <Link to="/listings">Listings</Link>
          <Link to="/compare">Compare</Link>
          {user ? (
            <>
              <span className="muted-text">Hi, {user.name}</span>
              <button className="btn btn-secondary btn-small" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <Link to="/login">Login</Link>
              <Link to="/register" className="btn btn-primary btn-small">Sign up</Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero-card">
        <div>
          <p className="eyebrow">Trusted used car insights</p>
          <h1>Verify history, condition, and maintenance before you buy.</h1>
          <p className="hero-text">Get verified history reports, inspection scores, and maintenance cost estimates from one place.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/listings">Browse cars</Link>
            <Link className="btn btn-secondary" to="/sell/new">Sell your car</Link>
          </div>
        </div>
      </section>

      <section className="feature-grid">
        <div className="feature-card"><h3>History verification</h3><p>Ownership, insurance, accident flags, and registration checks.</p></div>
        <div className="feature-card"><h3>Inspection score</h3><p>Condition reports with photos and structured checklist scoring.</p></div>
        <div className="feature-card"><h3>Maintenance forecast</h3><p>Predicted 12-month upkeep costs and likely upcoming repairs.</p></div>
      </section>
    </main>
  )
}

function ListingsPage({ user }: { user: any }) {
  const [cars, setCars] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    request('/api/cars')
      .then((data) => setCars(data.cars || []))
      .catch(() => setCars([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="page-shell">
      <header className="top-nav">
        <div><Link to="/" className="brand">VerifiedRide</Link></div>
        <nav className="nav-links">
          {user ? <span className="muted-text">Hi, {user.name}</span> : <Link to="/login">Login</Link>}
        </nav>
      </header>
      <section className="section-header"><div><p className="eyebrow">Marketplace</p><h1>Search listings</h1></div></section>
      {loading ? <p>Loading listings...</p> : (
        <section className="listing-grid">
          {cars.map((car) => (
            <article className="listing-card" key={car._id}>
              <img src={car.photos?.[0]} alt={`${car.make} ${car.model}`} />
              <div className="listing-content">
                <div className="listing-top-row">
                  <div>
                    <p className="listing-title">{car.make} {car.model}</p>
                    <p className="muted-text">{car.year} · {car.fuelType} · {car.transmission}</p>
                  </div>
                  <span className="score-pill">{car.verificationScore}/100</span>
                </div>
                <p className="listing-price">{formatCurrency(car.price)}</p>
                <p className="muted-text">{car.mileageKm.toLocaleString()} km · {car.location?.city}</p>
                <div className="listing-actions">
                  <Link className="btn btn-primary" to={`/listings/${car._id}`}>View details</Link>
                  <Link className="btn btn-secondary" to="/compare">Compare</Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

function ListingDetailPage({ user }: { user: any }) {
  const { id } = useParams()
  const [car, setCar] = useState<any>(null)
  const [estimate, setEstimate] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [inquiryStatus, setInquiryStatus] = useState('')

  useEffect(() => {
    if (!id) return
    Promise.all([
      request(`/api/cars/${id}`),
      request(`/api/cars/${id}/maintenance-estimate`),
    ])
      .then(([carData, estimateData]) => {
        setCar(carData.car)
        setEstimate(estimateData)
      })
      .catch(() => setCar(null))
      .finally(() => setLoading(false))
  }, [id])

  const submitInquiry = async () => {
    if (!user || !message.trim()) return
    try {
      await request('/api/inquiries', {
        method: 'POST',
        body: JSON.stringify({ carId: id, message }),
      })
      setInquiryStatus('Inquiry sent successfully')
      setMessage('')
    } catch (error: any) {
      setInquiryStatus(error.message)
    }
  }

  if (loading || !car) return <main className="page-shell">Loading car details...</main>

  return (
    <main className="page-shell">
      <header className="top-nav"><div><Link to="/" className="brand">VerifiedRide</Link></div></header>
      <section className="detail-layout">
        <div><img className="detail-image" src={car.photos?.[0]} alt={`${car.make} ${car.model}`} /></div>
        <div>
          <p className="eyebrow">Verified listing</p>
          <h1>{car.make} {car.model}</h1>
          <p className="listing-price">{formatCurrency(car.price)}</p>
          <ul className="detail-stats">
            <li>{car.year}</li>
            <li>{car.mileageKm.toLocaleString()} km</li>
            <li>{car.fuelType}</li>
            <li>{car.transmission}</li>
          </ul>
          <p>{car.description}</p>
        </div>
      </section>
      <section className="detail-panel-grid">
        <div className="detail-panel"><h3>History report</h3><p>Verification score: {car.verificationScore}/100</p><p>Insurance and ownership data are pending manual review.</p></div>
        <div className="detail-panel"><h3>Condition report</h3><p>Condition score: {car.conditionScore}/100</p><p>Inspector checklist and photo evidence attached.</p></div>
        <div className="detail-panel"><h3>Maintenance estimate</h3><p>{formatCurrency(estimate.range.min)} - {formatCurrency(estimate.range.max)}</p><p>{estimate.likelyUpcoming?.map((item: any) => item.item).join(', ')}</p></div>
      </section>
      <section className="detail-panel" style={{ marginTop: 18 }}>
        <h3>Contact seller</h3>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask about the car, service history, or inspection details" />
        <button className="btn btn-primary" onClick={submitInquiry} disabled={!user}>Send inquiry</button>
        {inquiryStatus && <p className="muted-text">{inquiryStatus}</p>}
      </section>
    </main>
  )
}

function ComparePage({ user }: { user: any }) {
  const demoCars = [
    { make: 'Hyundai', model: 'Creta', price: 1399000, conditionScore: 78, verificationScore: 84 },
    { make: 'Maruti Suzuki', model: 'Swift', price: 649000, conditionScore: 74, verificationScore: 76 },
    { make: 'Toyota', model: 'Fortuner', price: 2895000, conditionScore: 82, verificationScore: 88 },
  ]

  return (
    <main className="page-shell">
      <header className="top-nav"><div><Link to="/" className="brand">VerifiedRide</Link></div>{user ? <span className="muted-text">Hi, {user.name}</span> : null}</header>
      <h1>Compare cars</h1>
      <section className="comparison-table">
        <table>
          <thead><tr><th>Model</th><th>Price</th><th>Condition</th><th>Verification</th></tr></thead>
          <tbody>
            {demoCars.map((car) => (
              <tr key={`${car.make}-${car.model}`}>
                <td>{car.make} {car.model}</td>
                <td>{formatCurrency(car.price)}</td>
                <td>{car.conditionScore}/100</td>
                <td>{car.verificationScore}/100</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function LoginPage({ setUser }: { setUser: (value: any) => void }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const data = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      localStorage.setItem('token', data.token)
      setUser(data.user)
      navigate('/listings')
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <main className="page-shell auth-page">
      <div className="auth-card">
        <h1>Login</h1>
        <p>Access your saved listings and inquiries.</p>
        <form className="auth-form" onSubmit={submit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-primary" type="submit">Sign in</button>
          {error && <p className="muted-text">{error}</p>}
        </form>
      </div>
    </main>
  )
}

function RegisterPage({ setUser }: { setUser: (value: any) => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('buyer')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const data = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      })
      localStorage.setItem('token', data.token)
      setUser(data.user)
      navigate('/listings')
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <main className="page-shell auth-page">
      <div className="auth-card">
        <h1>Register</h1>
        <p>Create an account as a buyer, seller, or inspector.</p>
        <form className="auth-form" onSubmit={submit}>
          <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            <option value="inspector">Inspector</option>
          </select>
          <button className="btn btn-primary" type="submit">Create account</button>
          {error && <p className="muted-text">{error}</p>}
        </form>
      </div>
    </main>
  )
}

function CreateListingPage({ user }: { user: any }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    make: '', model: '', variant: '', year: '', mileageKm: '', fuelType: '', transmission: '', registrationNumber: '', price: '', city: '', state: '', description: '',
  })
  const [error, setError] = useState('')

  if (!user) {
    return <main className="page-shell">Please log in to create a listing.</main>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await request('/api/cars', {
        method: 'POST',
        body: JSON.stringify({
          make: form.make,
          model: form.model,
          variant: form.variant,
          year: Number(form.year),
          mileageKm: Number(form.mileageKm),
          fuelType: form.fuelType,
          transmission: form.transmission,
          registrationNumber: form.registrationNumber,
          price: Number(form.price),
          location: { city: form.city, state: form.state },
          description: form.description,
        }),
      })
      navigate('/listings')
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <main className="page-shell">
      <h1>Create listing</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <input placeholder="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
        <input placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input placeholder="Variant" value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} />
        <input placeholder="Year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
        <input placeholder="Mileage" value={form.mileageKm} onChange={(e) => setForm({ ...form, mileageKm: e.target.value })} />
        <input placeholder="Fuel type" value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })} />
        <input placeholder="Transmission" value={form.transmission} onChange={(e) => setForm({ ...form, transmission: e.target.value })} />
        <input placeholder="Registration number" value={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
        <input placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn btn-primary" type="submit">Save listing</button>
        {error && <p className="muted-text">{error}</p>}
      </form>
    </main>
  )
}

export default App
