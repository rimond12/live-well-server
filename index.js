const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);

const serviceAccount = JSON.parse(decodedKey);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programmingproject.e8odsjn.mongodb.net/?retryWrites=true&w=majority&appName=ProgrammingProject`;

// Create MongoClient with options
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const db = client.db("liveWellDB");

    const apartmentsCollection = db.collection("apartments");
    const agreementsCollection = db.collection("agreements");
    const usersCollection = db.collection("users");
    const couponsCollection = db.collection("coupons");
    const paymentsCollection = db.collection("payments");
    const announcementsCollection = db.collection("announcements");

    // custom middleware

    verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifyMember = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "member") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const email = req.body.email;

      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res
          .status(200)
          .send({ message: "user already exist", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // GET apartments with pagination and rent filtering
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
        res.status(500).send({ error: "Failed to fetch apartments." });
      }
    });

    // GET agreement by user email
    app.get("/agreements/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const agreement = await agreementsCollection.findOne({
          userEmail: email,
        });
        res.send(agreement);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch agreement." });
      }
    });

    // POST new agreement
    app.post("/agreements", async (req, res) => {
      try {
        const agreement = req.body;

        const existing = await agreementsCollection.findOne({
          userEmail: agreement.userEmail,
        });

        if (existing) {
          return res
            .status(409)
            .send({ message: "User already has an agreement." });
        }

        agreement.status = "pending";
        const result = await agreementsCollection.insertOne(agreement);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to create agreement." });
      }
    });

    // POST payment
    app.post("/payments", async (req, res) => {
      try {
        const paymentData = req.body;
        const result = await paymentsCollection.insertOne(paymentData);
        res
          .status(201)
          .send({ success: true, message: "Payment recorded", data: result });
      } catch (error) {
        res.status(500).send({ success: false, message: "Payment failed" });
      }
    });

    // POST validate coupon
    app.post("/validate-coupon", async (req, res) => {
      try {
        const { couponCode } = req.body;

        if (!couponCode || typeof couponCode !== "string") {
          return res
            .status(400)
            .send({ valid: false, message: "Coupon code is required" });
        }

        const coupon = await couponsCollection.findOne({
          code: couponCode.toUpperCase(),
          active: true,
        });

        if (!coupon) {
          return res
            .status(404)
            .send({ valid: false, message: "Invalid or inactive coupon" });
        }

        res.send({
          valid: true,
          discountPercentage: coupon.discount,
          description: coupon.description || "",
        });
      } catch (error) {
        res
          .status(500)
          .send({ valid: false, message: "Coupon validation failed" });
      }
    });

    // GET all agreements (admin)
    app.get("/agreements", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const agreements = await agreementsCollection.find().toArray();
        res.send(agreements);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch agreements" });
      }
    });

    app.get("/agreements/user/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      try {
        const agreement = await agreementsCollection.findOne({
          userEmail: email,
        });
        const user = await usersCollection.findOne({ email: email });

        if (!agreement) {
          return res.status(404).send({ message: "No agreement found" });
        }

        // Merge role with agreement object
        const response = {
          ...agreement,
          role: user?.role || "user",
          displayName: user?.displayName || "",
        };

        res.send(response);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/agreement", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email required" });

      const agreement = await agreementsCollection.findOne({
        userEmail: email,
        status: "checked",
      });

      if (!agreement) {
        return res.status(404).send({ message: "No active agreement found" });
      }

      res.send(agreement);
    });

    // POST announcement
    app.post("/announcements", async (req, res) => {
      try {
        const { title, description } = req.body;
        if (!title || !description) {
          return res
            .status(400)
            .send({ message: "Title and description required" });
        }
        const announcement = {
          title,
          description,
          date: new Date(),
        };
        const result = await announcementsCollection.insertOne(announcement);
        if (result.insertedId) {
          res.status(201).send({
            message: "Announcement posted",
            insertedId: result.insertedId,
          });
        } else {
          res.status(500).send({ message: "Failed to post announcement" });
        }
      } catch (err) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/announcements", async (req, res) => {
      try {
        const announcements = await announcementsCollection
          .find()
          .sort({ date: -1 })
          .toArray();
        res.send(announcements);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch announcements" });
      }
    });

    // GET all coupons
    app.get("/coupons", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch coupons" });
      }
    });

    // Public coupons endpoint
    app.get("/coupon", async (req, res) => {
      try {
        // active = true filter
        const coupons = await couponsCollection
          .find({ active: true })
          .toArray();
        res.send(coupons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // POST new coupon
    app.post("/coupons", async (req, res) => {
      const { code, discountPercentage, description, active } = req.body;

      if (
        !code ||
        typeof discountPercentage !== "number" ||
        discountPercentage <= 0
      ) {
        return res.status(400).json({ message: "Invalid coupon data" });
      }

      const result = await couponsCollection.insertOne({
        code,
        description,
        discount: discountPercentage,
        active: active !== false,
      });

      res.status(201).json(result);
    });

    // Update coupon availability
    app.patch("/coupons/:id", async (req, res) => {
      const id = req.params.id;
      const { active } = req.body;
      const result = await couponsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { active } }
      );
      res.send(result);
    });

    // DELETE coupon by ID
    app.delete("/coupons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await couponsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to delete coupon" });
      }
    });

    // ---- Manage Members: Get all members ----
    app.get("/members", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const members = await usersCollection
          .find({ role: "member" })
          .toArray();
        res.send(members);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch members" });
      }
    });

    // ---- Remove member (role -> user) ----
    app.patch("/members/:id/remove", async (req, res) => {
      const memberId = req.params.id;

      if (!ObjectId.isValid(memberId)) {
        return res.status(400).json({ message: "Invalid member ID" });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(memberId), role: "member" },
          { $set: { role: "user" } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Member not found or already removed",
          });
        }

        res.json({ success: true, message: "Member removed successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to remove member" });
      }
    });

    // 1. Create Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount } = req.body;
        if (!amount || typeof amount !== "number" || amount <= 0) {
          return res.status(400).json({ error: "Invalid amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // POST to verify coupon
    app.post("/verify-coupon", async (req, res) => {
      const { code, rent } = req.body;
      if (!code || typeof rent !== "number") {
        return res
          .status(400)
          .json({ valid: false, message: "Code and rent required" });
      }

      try {
        const coupon = await couponsCollection.findOne({
          code: code.toUpperCase(),
          active: true,
        });

        if (!coupon) {
          return res.json({
            valid: false,
            message: "Invalid or expired coupon",
          });
        }

        //  Use 'discount' instead of 'discountPercentage'
        const discountAmount = (rent * coupon.discount) / 100;
        const discountedAmount = rent - discountAmount;

        return res.json({
          valid: true,
          discountPercentage: coupon.discount,
          discountedAmount,
        });
      } catch (err) {
        return res.status(500).json({ valid: false, message: "Server error" });
      }
    });

    // 3. Save Payment
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;

        // Check if payment already exists for same agreementId and month
        const existingPayment = await paymentsCollection.findOne({
          agreementId: payment.agreementId,
          month: payment.month,
          status: "paid",
        });

        if (existingPayment) {
          return res.status(400).send({
            success: false,
            message: "Payment already done for this month.",
          });
        }

        const result = await paymentsCollection.insertOne(payment);
        res.send({
          success: true,
          message: "Payment recorded",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Payment recording failed" });
      }
    });

    // 4. Get User Payments
    app.get("/payments", verifyFBToken, verifyMember, async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }

        if (!userEmail)
          return res.status(400).send({ message: "⚠️ Email is required" });

        const payments = await paymentsCollection
          .find({ email: userEmail })
          .sort({ date: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

    // GET all pending agreements
    app.get(
      "/agreement/pending",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const pendingAgreements = await agreementsCollection
            .find({ status: "pending" })
            .toArray();

          return res.status(200).json(pendingAgreements);
        } catch (error) {
          return res.status(500).json({ message: "Internal Server Error" });
        }
      }
    );

    // PATCH accept
    app.patch("/agreements/:id/accept", async (req, res) => {
      const id = req.params.id;
      try {
        const agreement = await agreementsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!agreement)
          return res.status(404).send({ message: "Agreement not found" });
        await usersCollection.updateOne(
          { email: agreement.userEmail },
          { $set: { role: "member" } }
        );

        // Update status checked
        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked", agreementDate: new Date() } }
        );

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // PATCH reject
    app.patch("/agreements/:id/reject", async (req, res) => {
      const id = req.params.id;
      try {
        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked" } }
        );
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/users/role/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res
            .status(400)
            .json({ message: "Email parameter is required" });
        }

        const user = await usersCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({ role: user.role || "user" });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/admin/stats", async (req, res) => {
      try {
        const adminEmail = req.query.email;
        const admin = await usersCollection.findOne({
          email: adminEmail,
          role: "admin",
        });
        if (!admin) return res.status(404).send({ message: "Admin not found" });

        const totalRooms = await apartmentsCollection.countDocuments();
        const bookedAgreements = await agreementsCollection
          .find({}, { projection: { apartmentId: 1 } })
          .toArray();
        const bookedApartmentIds = [
          ...new Set(bookedAgreements.map((a) => a.apartmentId)),
        ];

        const unavailableRooms = bookedApartmentIds.length;
        const availableRooms = totalRooms - unavailableRooms;

        const totalUsers = await usersCollection.countDocuments();
        const totalMembers = await usersCollection.countDocuments({
          role: "member",
        });

        const availablePercentage = (
          (availableRooms / totalRooms) *
          100
        ).toFixed(2);
        const unavailablePercentage = (
          (unavailableRooms / totalRooms) *
          100
        ).toFixed(2);

        res.send({
          adminName: admin.displayName || "Admin",
          adminEmail: admin.email,
          adminImage: admin.photoURL || "https://i.ibb.co/example/admin.jpg",
          totalRooms,
          availablePercentage,
          unavailablePercentage,
          totalUsers,
          totalMembers,
        });
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });
    

    // GET featured apartments
    app.get("/apartments/featured", async (req, res) => {
      try {
        const featured = await apartmentsCollection.find({ isFeatured: true }).toArray();
        res.send(featured);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch featured apartments" });
      }
    });



    // Ping test
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } catch (err) {
    console.error(err);
  }
  // client.close(); // don't close, keep server running
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🛠️ Building Management Server is running");
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
