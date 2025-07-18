const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programmingproject.e8odsjn.mongodb.net/?retryWrites=true&w=majority&appName=ProgrammingProject`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("liveWellDB");

    const apartmentsCollection = db.collection("apartments");
    const agreementsCollection = db.collection("agreements");
    // const usersCollection = db.collection("users");
    const couponsCollection = db.collection("coupons");
    const paymentsCollection = db.collection("payments");
    // const announcementsCollection = db.collection("announcements");

    //

    // GET all apartments with pagination and rent range filtering
    app.get("/apartments", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const min = parseInt(req.query.min) || 0;
        const max = parseInt(req.query.max) || 999999;

        const filter = {
          rent: {
            $gte: min,
            $lte: max,
          },
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

    // agreement

    // ✅ Check if user has agreement
    app.get("/agreements/:email", async (req, res) => {
      const email = req.params.email;
      const result = await agreementsCollection.findOne({ userEmail: email });
      res.send(result);
    });

    // POST agreement
    app.post("/agreements", async (req, res) => {
      const agreement = req.body;

      const existing = await agreementsCollection.findOne({
        userEmail: agreement.userEmail,
      });

      if (existing) {
        return res
          .status(400)
          .send({ message: "User already has an agreement." });
      }

      agreement.status = "pending";
      const result = await agreementsCollection.insertOne(agreement);
      res.send(result);
    });

    // paymnet

    // POST /payments - পেমেন্ট সংরক্ষণ
    app.post("/payments", async (req, res) => {
      try {
        const paymentData = req.body;
        // paymentData এর expected ফিল্ডঃ
        // memberEmail, floorNo, blockName, apartmentNo, rent, month, couponCode, finalAmount, paymentDate ইত্যাদি

        const result = await paymentsCollection.insertOne(paymentData);

        res
          .status(201)
          .send({ success: true, message: "Payment recorded", data: result });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Payment failed" });
      }
    });

    // POST /validate-coupon - কুপন যাচাই ও ডিসকাউন্ট ফেরত দিবে
    app.post("/validate-coupon", async (req, res) => {
      try {
        const { couponCode } = req.body;

        const coupon = await couponsCollection.findOne({
          code: couponCode,
          active: true,
        });

        if (!coupon) {
          return res
            .status(404)
            .send({ valid: false, message: "Invalid or inactive coupon" });
        }

        res.send({
          valid: true,
          discountPercentage: coupon.discountPercentage,
          description: coupon.description,
        });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ valid: false, message: "Coupon validation failed" });
      }
    });

    // allagreement

    // Accept agreement - change status and role to member
    app.get("/agreements", async (req, res) => {
      const agreements = await agreementsCollection.find().toArray();
      res.send(agreements);
    });

    app.patch("/agreements/:id/accept", async (req, res) => {
      const id = req.params.id;
      try {
        const agreement = await agreementsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!agreement)
          return res.status(404).send({ message: "Agreement not found" });

        // Update agreement status to 'checked'
        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked" } }
        );

        // Update user role to 'member' (usersCollection required)
        await usersCollection.updateOne(
          { email: agreement.userEmail },
          { $set: { role: "member" } }
        );

        res.send({ message: "Agreement accepted and user role updated" });
      } catch (error) {
        res.status(500).send({ message: "Failed to accept agreement", error });
      }
    });

    // Reject agreement - update status only
    app.patch("/agreements/:id/reject", async (req, res) => {
      const id = req.params.id;
      try {
        const agreement = await agreementsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!agreement)
          return res.status(404).send({ message: "Agreement not found" });

        // Update agreement status to 'checked'
        await agreementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "checked" } }
        );

        // Do not change user role

        res.send({ message: "Agreement rejected" });
      } catch (error) {
        res.status(500).send({ message: "Failed to reject agreement", error });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🛠️ Building Management Server is running");
});

app.listen(port, () => {
  console.log(`🚀 Server running at ${port}`);
});
