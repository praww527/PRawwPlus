import { Router, type IRouter } from "express";
import { connectDB, ContactModel } from "@workspace/db";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const contacts = await ContactModel.find({ userId }).sort({ name: 1 }).lean();
  res.json({ contacts: contacts.map((c) => ({ ...c, id: String(c._id) })) });
});

router.post("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { name, number, fromPhone } = req.body;

  if (!name || !number) {
    res.status(400).json({ error: "name and number are required" });
    return;
  }

  const trimmedName = String(name).trim().slice(0, 100);
  const trimmedNumber = String(number).trim().replace(/\s+/g, "");

  if (trimmedNumber.length < 3 || trimmedNumber.length > 30) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  const existing = await ContactModel.findOne({ userId, number: trimmedNumber });
  if (existing) {
    await ContactModel.updateOne({ _id: existing._id }, { name: trimmedName });
    const updated = await ContactModel.findById(existing._id).lean();
    res.json({ ...updated, id: String(updated?._id) });
    return;
  }

  const contact = await ContactModel.create({
    _id: randomUUID(),
    userId,
    name: trimmedName,
    number: trimmedNumber,
    fromPhone: !!fromPhone,
  });

  res.status(201).json({ ...contact.toObject(), id: String(contact._id) });
});

router.post("/contacts/bulk", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    res.status(400).json({ error: "contacts array is required" });
    return;
  }

  if (contacts.length > 500) {
    res.status(400).json({ error: "Maximum 500 contacts per bulk import" });
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const c of contacts) {
    const name = String(c.name ?? "").trim().slice(0, 100);
    const number = String(c.number ?? "").trim().replace(/\s+/g, "");
    const fromPhone = !!c.fromPhone;

    if (!name || number.length < 3 || number.length > 30) {
      skipped++;
      continue;
    }

    try {
      await ContactModel.findOneAndUpdate(
        { userId, number },
        { $setOnInsert: { _id: randomUUID(), userId, name, number, fromPhone } },
        { upsert: true, returnDocument: 'after' },
      );
      imported++;
    } catch {
      skipped++;
    }
  }

  res.json({ imported, skipped });
});

router.delete("/contacts/:contactId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { contactId } = req.params;

  const result = await ContactModel.deleteOne({ _id: contactId, userId });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
