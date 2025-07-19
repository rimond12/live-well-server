const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

dotenv.config();

// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
// console.log("Decoded service account JSON:", decoded);
// const serviceAccount = JSON.parse(decoded);
// serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programmingproject.e8odsjn.mongodb.net/?retryWrites=true&w=majority&appName=ProgrammingProject`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware to verify Firebase token
// const verifyFireBaseToken = async (req, res, next) => {
//   const authHeader = req.headers?.authorization;

//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     return res.status(401).send({ message: "unauthorized access" });
//   }

//   const token = authHeader.split(" ")[1];

//   try {
//     const decodedToken = await admin.auth().verifyIdToken(token);
//     req.decoded = decodedToken;
//     next();
//   } catch (error) {
//     return res.status(401).send({ message: "unauthorized access" });
//   }
// };

// Middleware to verify that the email in params matches the decoded token email
// const verifyTokenEmail = (req, res, next) => {
//   if (req.params.email !== req.decoded.email) {
//     return res.status(403).send({ message: "forbidden access" });
//   }
//   next();
// };

async function run() {
  try {
    await client.connect();

    const db = client.db("liveWellDB");

    const apartmentsCollection = db.collection("apartments");
    const agreementsCollection = db.collection("agreements");
    const usersCollection = db.collection("users");
    const couponsCollection = db.collection("coupons");
    const paymentsCollection = db.collection("payments");
    const announcementsCollection = db.collection("announcements");

    // --- Apartments with pagination and rent filtering ---
    app.get("/apartments", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const min = parseInt(req.query.min) || 0;
        const max = parseInt(req.query.max) || 999999;

        const filter = {
          rent: { $gte: min, $lte: max },
        };

        const apartments = await apartmentsCollection
          .find(filter)
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        const total = await apartmentsCollection.countDocuments(filter);

        res.send({ apartments, total });
      } catch (err) {
        console.error("Apartment fetch error:", err.message);
        res.status(500).send({ error: "Failed to fetch apartments." });
      }
    });

    // --- Get agreement by user email ---
    app.get("/agreements/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const agreement = await agreementsCollection.findOne({ userEmail: email });
        res.send(agreement);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch agreement." });
      }
    });

    // --- POST new agreement ---
    app.post("/agreements", async (req, res) => {
      try {
        const agreement = req.body;

        const existing = await agreementsCollection.findOne({
          userEmail: agreement.userEmail,
        });

        if (existing) {
          return res.status(400).send({ message: "User already has an agreement." });
        }

        agreement.status = "pending";
        const result = await agreementsCollection.insertOne(agreement);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create agreement." });
      }
    });

    // --- POST payment ---
    app.post("/payments", async (req, res) => {
      try {
        const paymentData = req.body;
        const result = await paymentsCollection.insertOne(paymentData);
        res.status(201).send({ success: true, message: "Payment recorded", data: result });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Payment failed" });
      }
    });

    // --- GET payments by user email ---
    app.get("/payments", async (req, res) => {
      try {
        const userEmail = req.query.email;
        if (!userEmail) return res.status(400).send({ message: "Email is required" });

        const payments = await paymentsCollection.find({ userEmail }).toArray();
        res.send(payments);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

    // --- POST validate coupon ---
    app.post("/validate-coupon", async (req, res) => {
      try {
        const { couponCode } = req.body;

        if (!couponCode || typeof couponCode !== "string") {
          return res.status(400).send({ valid: false, message: "Coupon code is required" });
        }

        const coupon = await couponsCollection.findOne({
          code: couponCode.toUpperCase(),
          active: true,
        });

        if (!coupon) {
          return res.status(404).send({ valid: false, message: "Invalid or inactive coupon" });
        }

        res.send({
          valid: true,
          discountPercentage: coupon.discount,
          description: coupon.description || "",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ valid: false, message: "Coupon validation failed" });
      }
    });

    // --- GET all agreements (admin) ---
    app.get("/agreements", async (req, res) => {
      try {
        const agreements = await agreementsCollection.find().toArray();
        res.send(agreements);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch agreements" });
      }
    });

    // --- PATCH accept agreement and update user role ---
    app.patch("/agreements/:id/accept", async (req, res) => {
      const id = req.params.id;
      try {
        const agreement = await agreementsCollection.findOne({ _id: new ObjectId(id) });
        if (!agreement) return res.status(404).send({ message: "Agreement not found" });

        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked" } }
        );

        await usersCollection.updateOne(
          { email: agreement.userEmail },
          { $set: { role: "member" } }
        );

        res.send({ message: "Agreement accepted and user role updated" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to accept agreement", error });
      }
    });

    // --- PATCH reject agreement (update status only) ---
    app.patch("/agreements/:id/reject", async (req, res) => {
      const id = req.params.id;
      try {
        const agreement = await agreementsCollection.findOne({ _id: new ObjectId(id) });
        if (!agreement) return res.status(404).send({ message: "Agreement not found" });

        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked" } }
        );

        res.send({ message: "Agreement rejected" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to reject agreement", error });
      }
    });

    // --- POST announcement ---
    app.post("/announcements", async (req, res) => {
      try {
        const { title, description } = req.body;
        if (!title || !description) {
          return res.status(400).send({ message: "Title and description required" });
        }
        const announcement = {
          title,
          description,
          date: new Date(),
        };
        const result = await announcementsCollection.insertOne(announcement);
        if (result.insertedId) {
          res.status(201).send({ message: "Announcement posted", insertedId: result.insertedId });
        } else {
          res.status(500).send({ message: "Failed to post announcement" });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // --- GET announcements ---
    app.get("/announcements", async (req, res) => {
      try {
        const announcements = await announcementsCollection.find().sort({ date: -1 }).toArray();
        res.send(announcements);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch announcements" });
      }
    });

    // --- GET all coupons ---
    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch coupons" });
      }
    });

    // --- POST new coupon ---
    app.post("/coupons", async (req, res) => {
      const { code, discountPercentage, active } = req.body;

      if (!code || typeof discountPercentage !== "number" || discountPercentage <= 0) {
        return res.status(400).json({ message: "Invalid coupon data" });
      }

      const result = await couponsCollection.insertOne({
        code,
        discount: discountPercentage,
        active: active !== false,
      });

      res.status(201).json(result);
    });

    // --- DELETE coupon by ID ---
    app.delete("/coupons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await couponsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to delete coupon" });
      }
    });

    // --- Middleware to verify admin role (example) ---
    const verifyAdmin = async (req, res, next) => {
      const userEmail = req.decoded?.email; // from token middleware

      if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

      const user = await usersCollection.findOne({ email: userEmail });
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admins only" });
      }
      next();
    };

    // --- PATCH /users/:id/role to update user role (admin only) ---
    app.patch("/users/:id/role", async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      if (!["user", "member", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      try {
        const result = await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: { role } });

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ success: true, message: "Role updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // --- GET all users (admin dashboard to manage members) ---
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find({ role: { $in: ["user", "member"] } }).toArray();
        res.send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // --- DELETE user by ID ---
    app.delete("/users/:id",  async (req, res) => {
      try {
        const userId = req.params.id;
        const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json({ success: true, message: "User deleted successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to delete user" });
      }
    });

    // Ping test to confirm DB connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error(err);
  }
  // Do not close client to keep server running
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🛠️ Building Management Server is running");
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
