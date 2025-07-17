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
    // const couponsCollection = db.collection("coupons");
    // const paymentsCollection = db.collection("payments");
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
