const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/verifiedride';

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['buyer', 'seller', 'inspector', 'admin'], default: 'buyer' },
    phone: { type: String, default: '' },
    isVerified: { type: Boolean, default: true },
    trustScore: { type: Number, default: 0 },
    avatarUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

const listingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    variant: { type: String, default: '' },
    year: { type: Number, required: true },
    mileageKm: { type: Number, required: true },
    fuelType: { type: String, required: true },
    transmission: { type: String, required: true },
    registrationNumber: { type: String, required: true },
    price: { type: Number, required: true },
    location: {
      city: { type: String, required: true },
      state: { type: String, required: true },
      lat: Number,
      lng: Number,
    },
    photos: [{ type: String }],
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'active', 'sold', 'flagged', 'removed'],
      default: 'active',
    },
    verificationScore: { type: Number, default: 0 },
    conditionScore: { type: Number, default: 0 },
    predictedMaintenanceCost: {
      min: Number,
      max: Number,
      currency: { type: String, default: 'INR' },
      generatedAt: Date,
    },
    fairPriceEstimate: {
      low: Number,
      high: Number,
      verdict: { type: String, enum: ['underpriced', 'fair', 'overpriced'], default: 'fair' },
    },
  },
  { timestamps: true }
);

const historySchema = new mongoose.Schema(
  {
    carListingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    source: { type: String, enum: ['api', 'manual', 'admin_verified'], default: 'manual' },
    ownersCount: Number,
    registrationDate: Date,
    fitnessValidTill: Date,
    insuranceValidTill: Date,
    hypothecationStatus: { type: String, default: 'none' },
    accidentFlag: { type: Boolean, default: false },
    theftFlag: { type: Boolean, default: false },
    odometerReadings: [{ date: Date, km: Number, source: String }],
    verifiedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
  },
  { timestamps: true }
);

const inspectionSchema = new mongoose.Schema(
  {
    carListingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    inspectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checklist: [
      {
        part: String,
        score: Number,
        notes: String,
        photoUrls: [String],
      },
    ],
    overallConditionScore: Number,
    inspectedAt: Date,
  },
  { timestamps: true }
);

const inquirySchema = new mongoose.Schema(
  {
    carListingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    messages: [
      {
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: String,
        sentAt: { type: Date, default: Date.now },
        readAt: Date,
      },
    ],
  },
  { timestamps: true }
);

const reviewSchema = new mongoose.Schema(
  {
    carListingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
  },
  { timestamps: true }
);

const maintenanceReferenceSchema = new mongoose.Schema(
  {
    make: String,
    model: String,
    reliabilityIndex: Number,
    commonIssuesByMileage: [
      {
        kmThreshold: Number,
        issue: String,
        estCost: Number,
      },
    ],
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);
const HistoryReport = mongoose.model('HistoryReport', historySchema);
const InspectionReport = mongoose.model('InspectionReport', inspectionSchema);
const Inquiry = mongoose.model('Inquiry', inquirySchema);
const Review = mongoose.model('Review', reviewSchema);
const MaintenanceReference = mongoose.model('MaintenanceReference', maintenanceReferenceSchema);

function maskRegistration(value) {
  if (!value) return '';
  const digits = value.replace(/[^A-Z0-9]/gi, '');
  if (digits.length <= 4) return value;
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'dev-access-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function ensureRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

async function seedData() {
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@verifiedride.com',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      role: 'admin',
      isVerified: true,
    });
    await User.create({
      name: 'Aarav Sharma',
      email: 'aarav@example.com',
      passwordHash: await bcrypt.hash('Buyer123!', 10),
      role: 'buyer',
      isVerified: true,
    });
    await User.create({
      name: 'Riya Dealer',
      email: 'riya@example.com',
      passwordHash: await bcrypt.hash('Seller123!', 10),
      role: 'seller',
      isVerified: true,
    });
    console.log('Seeded default users:', admin.email);
  }

  const listingCount = await Listing.countDocuments();
  if (listingCount === 0) {
    const seller = await User.findOne({ role: 'seller' });
    if (seller) {
      const sampleCars = [
        {
          sellerId: seller._id,
          make: 'Hyundai',
          model: 'Creta',
          variant: 'SX 1.5 Diesel',
          year: 2021,
          mileageKm: 32000,
          fuelType: 'Diesel',
          transmission: 'Automatic',
          registrationNumber: 'DL01AB1234',
          price: 1399000,
          location: { city: 'Noida', state: 'UP' },
          photos: [
            'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80',
          ],
          verificationScore: 84,
          conditionScore: 78,
          description: 'Single owner, well maintained, accident-free with full service history.',
        },
        {
          sellerId: seller._id,
          make: 'Maruti Suzuki',
          model: 'Swift',
          variant: 'VXI',
          year: 2019,
          mileageKm: 42000,
          fuelType: 'Petrol',
          transmission: 'Manual',
          registrationNumber: 'HR26CD5678',
          price: 649000,
          location: { city: 'Gurgaon', state: 'HR' },
          photos: [
            'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=900&q=80',
          ],
          verificationScore: 76,
          conditionScore: 74,
          description: 'Great city commuter with good mileage and excellent maintenance logs.',
        },
        {
          sellerId: seller._id,
          make: 'Toyota',
          model: 'Fortuner',
          variant: '2.8 4x4 MT',
          year: 2020,
          mileageKm: 61000,
          fuelType: 'Diesel',
          transmission: 'Manual',
          registrationNumber: 'KA01MN9988',
          price: 2895000,
          location: { city: 'Bangalore', state: 'KA' },
          photos: [
            'https://images.unsplash.com/photo-1549399542-7e3f7c2813b9?auto=format&fit=crop&w=900&q=80',
          ],
          verificationScore: 88,
          conditionScore: 82,
          description: 'Premium SUV in excellent shape with recent tyre and brake replacement.',
        },
      ];
      await Listing.insertMany(sampleCars);
      console.log('Seeded sample listings');
    }
  }

  const referenceCount = await MaintenanceReference.countDocuments();
  if (referenceCount === 0) {
    await MaintenanceReference.insertMany([
      {
        make: 'Hyundai',
        model: 'Creta',
        reliabilityIndex: 0.88,
        commonIssuesByMileage: [
          { kmThreshold: 30000, issue: 'Brake pad replacement', estCost: 6500 },
          { kmThreshold: 45000, issue: 'Tyre rotation and alignment', estCost: 3500 },
        ],
      },
      {
        make: 'Maruti Suzuki',
        model: 'Swift',
        reliabilityIndex: 0.9,
        commonIssuesByMileage: [
          { kmThreshold: 40000, issue: 'Brake service', estCost: 4200 },
          { kmThreshold: 50000, issue: 'Suspension check', estCost: 2800 },
        ],
      },
      {
        make: 'Toyota',
        model: 'Fortuner',
        reliabilityIndex: 0.95,
        commonIssuesByMileage: [
          { kmThreshold: 60000, issue: 'Coolant and fluid service', estCost: 8200 },
        ],
      },
    ]);
  }
}

app.get('/', (req, res) => {
  const clientIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');
  if (fs.existsSync(clientIndexPath)) {
    return res.sendFile(clientIndexPath);
  }

  return res.json({
    status: 'ok',
    message: 'VerifiedRide API is running',
    docs: '/api/health'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'VerifiedRide API is running' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role: role && ['buyer', 'seller', 'inspector', 'admin'].includes(role) ? role : 'buyer',
    });

    const token = generateToken(user);
    res.status(201).json({
      message: 'User registered successfully',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({
      message: 'Login successful',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load profile' });
  }
});

app.get('/api/cars', async (req, res) => {
  try {
    const { make, location, minPrice, maxPrice, fuelType } = req.query;
    const query = { status: { $ne: 'removed' } };

    if (make) query.make = { $regex: make, $options: 'i' };
    if (fuelType) query.fuelType = fuelType;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const cars = await Listing.find(query)
      .populate('sellerId', 'name email role')
      .sort({ createdAt: -1 });

    const response = cars.map((car) => ({
      ...car.toObject(),
      registrationNumber: maskRegistration(car.registrationNumber),
    }));

    res.json({ cars: response, count: response.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listings', error: error.message });
  }
});

app.post('/api/cars', authMiddleware, ensureRole('seller', 'admin'), async (req, res) => {
  try {
    const {
      make,
      model,
      variant,
      year,
      mileageKm,
      fuelType,
      transmission,
      registrationNumber,
      price,
      location,
      photos,
      description,
    } = req.body;

    if (!make || !model || !year || !mileageKm || !fuelType || !transmission || !registrationNumber || !price || !location) {
      return res.status(400).json({ message: 'Please provide all required listing fields' });
    }

    const listing = await Listing.create({
      sellerId: req.user.id,
      make,
      model,
      variant: variant || '',
      year,
      mileageKm,
      fuelType,
      transmission,
      registrationNumber,
      price,
      location,
      photos: photos || [],
      description: description || '',
      verificationScore: 75,
      conditionScore: 75,
    });

    res.status(201).json({ listing });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create listing', error: error.message });
  }
});

app.get('/api/cars/:id', async (req, res) => {
  try {
    const car = await Listing.findById(req.params.id).populate('sellerId', 'name email role');
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }
    res.json({
      car: {
        ...car.toObject(),
        registrationNumber: maskRegistration(car.registrationNumber),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch listing', error: error.message });
  }
});

app.get('/api/cars/:id/maintenance-estimate', async (req, res) => {
  try {
    const car = await Listing.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const reference = await MaintenanceReference.findOne({
      make: car.make,
      model: car.model,
    });

    const ageFactor = Math.max(0.8, 1 - (new Date().getFullYear() - car.year) * 0.04);
    const mileageFactor = Math.max(0.9, 1 - car.mileageKm / 250000);
    const base = Math.round((car.price / 5000) * ageFactor * mileageFactor);
    const conditionAdjustment = Math.max(0, (100 - car.conditionScore) * 12);

    const upcoming = reference?.commonIssuesByMileage?.filter((item) => item.kmThreshold >= car.mileageKm - 5000 && item.kmThreshold <= car.mileageKm + 5000) || [];
    const serviceFlags = upcoming.map((item) => ({ item: item.issue, estCost: item.estCost }));
    const estimate = base + conditionAdjustment + serviceFlags.reduce((sum, flag) => sum + flag.estCost, 0);

    res.json({
      carId: req.params.id,
      currency: 'INR',
      range: { min: Math.round(estimate * 0.8), max: Math.round(estimate * 1.2) },
      likelyUpcoming: serviceFlags,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to compute maintenance estimate', error: error.message });
  }
});

app.get('/api/cars/:id/fair-price', async (req, res) => {
  try {
    const car = await Listing.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const similar = await Listing.find({
      make: car.make,
      model: car.model,
      status: { $ne: 'removed' },
      _id: { $ne: car._id },
    }).select('price conditionScore verificationScore');

    const avg = similar.length
      ? similar.reduce((sum, entry) => sum + entry.price, 0) / similar.length
      : car.price;

    const low = Math.round(avg * 0.9);
    const high = Math.round(avg * 1.1);
    const verdict = car.price < low ? 'underpriced' : car.price > high ? 'overpriced' : 'fair';

    res.json({
      carId: req.params.id,
      estimate: { low, high },
      verdict,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to compute fair price', error: error.message });
  }
});

app.post('/api/inquiries', authMiddleware, async (req, res) => {
  try {
    const { carId, message } = req.body;
    if (!carId || !message) {
      return res.status(400).json({ message: 'carId and message are required' });
    }

    const listing = await Listing.findById(carId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const inquiry = await Inquiry.create({
      carListingId: carId,
      buyerId: req.user.id,
      sellerId: listing.sellerId,
      messages: [{ senderId: req.user.id, text: message }],
    });

    res.status(201).json({ inquiry });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send inquiry', error: error.message });
  }
});

app.get('/api/admin/stats', authMiddleware, ensureRole('admin'), async (req, res) => {
  try {
    const totalListings = await Listing.countDocuments();
    const approvedSellers = await User.countDocuments({ role: 'seller' });
    const pendingInspections = await InspectionReport.countDocuments({ overallConditionScore: { $exists: false } });
    const averageVerificationScore = await Listing.aggregate([
      { $group: { _id: null, avg: { $avg: '$verificationScore' } } },
    ]);

    res.json({
      totalListings,
      approvedSellers,
      pendingInspections,
      averageVerificationScore: Math.round(averageVerificationScore[0]?.avg || 0),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load admin stats', error: error.message });
  }
});

app.get('/api/admin/users', authMiddleware, ensureRole('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load users' });
  }
});

const clientDistPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res) => {
    const clientIndexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(clientIndexPath) && !req.path.startsWith('/api')) {
      return res.sendFile(clientIndexPath);
    }
    return res.status(404).json({ message: 'Not found' });
  });
}

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    await seedData();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });
