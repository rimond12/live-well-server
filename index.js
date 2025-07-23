const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
//   "utf8"
// );
// const serviceAccount = JSON.parse(decoded);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");
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
    await client.connect();

    const db = client.db("liveWellDB");

    const apartmentsCollection = db.collection("apartments");
    const agreementsCollection = db.collection("agreements");
    const usersCollection = db.collection("users");
    const couponsCollection = db.collection("coupons");
    const paymentsCollection = db.collection("payments");
    const announcementsCollection = db.collection("announcements");

    // custom middleware

    verifyFBToken = async (req, res, next) => {
      console.log("header in middlware", req.headers);

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
        console.error("Apartment fetch error:", err.message);
        res.status(500).send({ error: "Failed to fetch apartments." });
      }
    });

    // GET agreement by user email
    app.get("/agreements/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const agreement = await agreementsCollection.findOne({
          userEmail: email,
        });
        res.send(agreement);
      } catch (error) {
        console.error(error);
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
            .status(400)
            .send({ message: "User already has an agreement." });
        }

        agreement.status = "pending";
        const result = await agreementsCollection.insertOne(agreement);
        res.send(result);
      } catch (error) {
        console.error(error);
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
        console.error(error);
        res.status(500).send({ success: false, message: "Payment failed" });
      }
    });

    // GET payments by user email (from query param)
    // app.get("/payments", async (req, res) => {
    //   try {
    //     const userEmail = req.query.email;
    //     if (!userEmail)
    //       return res.status(400).send({ message: "Email is required" });

    //     console.log("Requested payment for:", userEmail);

    //     const payments = await paymentsCollection
    //       .find({ memberEmail: userEmail }) // <-- ✅ Correct field name
    //       .toArray();

    //     console.log("Found payments:", payments.length);
    //     res.send(payments);
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Failed to fetch payments" });
    //   }
    // });

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
          discountPercentage: coupon.discount, // assuming your field is 'discount'
          description: coupon.description || "",
        });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ valid: false, message: "Coupon validation failed" });
      }
    });

    // GET all agreements (admin)
    // app.get("/agreements", async (req, res) => {
    //   try {
    //     const agreements = await agreementsCollection.find().toArray();
    //     res.send(agreements);
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ error: "Failed to fetch agreements" });
    //   }
    // });

    // app.get("/agreements/user/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const result = await agreementCollection.findOne({ userEmail: email });
    //   res.send(result);
    // });

    // // PATCH accept agreement and update user role
    // app.patch("/agreements/:id/accept", async (req, res) => {
    //   const id = req.params.id;
    //   try {
    //     const agreement = await agreementsCollection.findOne({
    //       _id: new ObjectId(id),
    //     });
    //     if (!agreement)
    //       return res.status(404).send({ message: "Agreement not found" });

    //     await agreementsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status: "checked" } }
    //     );

    //     await usersCollection.updateOne(
    //       { email: agreement.userEmail },
    //       { $set: { role: "member" } }
    //     );

    //     res.send({ message: "Agreement accepted and user role updated" });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Failed to accept agreement", error });
    //   }
    // });

    // // PATCH reject agreement (update status only)
    // app.patch("/agreements/:id/reject", async (req, res) => {
    //   const id = req.params.id;
    //   try {
    //     const agreement = await agreementsCollection.findOne({
    //       _id: new ObjectId(id),
    //     });
    //     if (!agreement)
    //       return res.status(404).send({ message: "Agreement not found" });

    //     await agreementsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status: "checked" } }
    //     );

    //     res.send({ message: "Agreement rejected" });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Failed to reject agreement", error });
    //   }
    // });

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
        console.error(err);
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
    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch coupons" });
      }
    });

    // POST new coupon
    app.post("/coupons", async (req, res) => {
      const { code, discountPercentage, active } = req.body;

      if (
        !code ||
        typeof discountPercentage !== "number" ||
        discountPercentage <= 0
      ) {
        return res.status(400).json({ message: "Invalid coupon data" });
      }

      const result = await couponsCollection.insertOne({
        code,
        discount: discountPercentage, // Store as 'discount'
        active: active !== false, // default true
      });

      res.status(201).json(result);
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
        console.error(error);
        res.status(500).send({ error: "Failed to delete coupon" });
      }
    });

    // Middleware to verify admin role (example)
    // const verifyAdmin = async (req, res, next) => {
    //   // assume you have user info in req.user (from auth middleware)
    //   const userEmail = req.user.email;

    //   const user = await usersCollection.findOne({ email: userEmail });
    //   if (user?.role !== "admin") {
    //     return res.status(403).json({ message: "Forbidden: Admins only" });
    //   }
    //   next();
    // };

    // PATCH /users/:id/role to update user role (admin only)
    // app.patch("/users/:id/role", verifyAdmin, async (req, res) => {
    //   const userId = req.params.id;
    //   const { role } = req.body;

    //   if (!["user", "member", "admin"].includes(role)) {
    //     return res.status(400).json({ message: "Invalid role" });
    //   }

    //   try {
    //     const result = await usersCollection.updateOne(
    //       { _id: new ObjectId(userId) },
    //       { $set: { role } }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).json({ message: "User not found" });
    //     }

    //     res.json({ success: true, message: "Role updated successfully" });
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Server error" });
    //   }
    // });

    // GET /users : role = user or member
    // GET /users - role user/member গুলো নিয়ে আসবে
    // app.get("/users", async (req, res) => {
    //   try {
    //     const users = await usersCollection
    //       .find({ role: { $in: ["user", "member"] } })
    //       .toArray();
    //     res.send(users);
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Failed to fetch users" });
    //   }
    // });

    // Members list আনবে (role === "member")
    // ---- Manage Members: Get all members ----
    app.get("/members", async (req, res) => {
      try {
        const members = await usersCollection
          .find({ role: "member" })
          .toArray();
        res.send(members);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch members" });
      }
    });

    // PATCH /users/:id/role - রোল আপডেট করবে
    // app.patch("/users/:id/role", async (req, res) => {
    //   const userId = req.params.id;

    //   // ObjectId validity চেক
    //   if (!ObjectId.isValid(userId)) {
    //     return res.status(400).json({ message: "Invalid user ID" });
    //   }

    //   const { role } = req.body;
    //   if (!["user", "member", "admin"].includes(role)) {
    //     return res.status(400).json({ message: "Invalid role" });
    //   }

    //   try {
    //     const result = await usersCollection.updateOne(
    //       { _id: new ObjectId(userId) }, // ObjectId তে convert করে query দিবে
    //       { $set: { role } }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).json({ message: "User not found" });
    //     }

    //     res.json({
    //       success: true,
    //       message: "Role updated successfully",
    //       modifiedCount: result.modifiedCount,
    //     });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ message: "Server error" });
    //   }
    // });

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
        console.error(error);
        res.status(500).json({ message: "Failed to remove member" });
      }
    });

    // app.delete("/users/:id", async (req, res) => {
    //   const userId = req.params.id;

    //   if (!ObjectId.isValid(userId)) {
    //     return res.status(400).json({ message: "Invalid user ID" });
    //   }

    //   try {
    //     const result = await usersCollection.deleteOne({
    //       _id: new ObjectId(userId),
    //     });

    //     if (result.deletedCount === 0) {
    //       return res.status(404).json({ message: "User not found" });
    //     }

    //     res.json({
    //       success: true,
    //       message: "User deleted successfully",
    //       deletedCount: result.deletedCount,
    //     });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ message: "Failed to delete user" });
    //   }
    // });

    // 1. Create Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount } = req.body;
        console.log("Received amount:", amount); // debug

        if (!amount || typeof amount !== "number" || amount <= 0) {
          return res.status(400).json({ error: "Invalid amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // 2. Validate Coupon
    // assuming you already have express app and body-parser or express.json() middleware set up

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

        // 🔄 Use 'discount' instead of 'discountPercentage'
        const discountAmount = (rent * coupon.discount) / 100;
        const discountedAmount = rent - discountAmount;

        return res.json({
          valid: true,
          discountPercentage: coupon.discount,
          discountedAmount,
        });
      } catch (err) {
        console.error("verify-coupon err:", err);
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
        console.error("Error recording payment:", error);
        res
          .status(500)
          .send({ success: false, message: "Payment recording failed" });
      }
    });

    // 4. Get User Payments
    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        console.log("decodde", req.decoded);

        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }

        if (!userEmail)
          return res.status(400).send({ message: "⚠️ Email is required" });

        const payments = await paymentsCollection
          .find({ email: userEmail }) // অথবা .find({ memberEmail: userEmail }) যদি ফিল্ড নাম memberEmail হয়
          .sort({ date: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("❌ Failed to fetch payments:", error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

//     GET all pending agreement requests
//    Pending agreement list
// GET all pending agreements
app.get("/agreement/pending", async (req, res) => {
  try {
    const pendingAgreements = await agreementsCollection
      .find({ status: "pending" })
      .toArray();

    console.log("Pending agreements:", pendingAgreements);

    return res.status(200).json(pendingAgreements);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});





// PATCH accept
app.patch("/agreements/:id/accept", async (req, res) => {
  const id = req.params.id;
  try {
    const agreement = await agreementsCollection.findOne({ _id: new ObjectId(id) });
    if (!agreement) return res.status(404).send({ message: "Agreement not found" });

    // Change user role to member
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
    console.error(error);
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
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

   

    // Ping test
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
