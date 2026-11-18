import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

/**
 * POST /api/upload  (logged-in users)
 * body: { image: "<base64 string or data URL>" }
 * The ImgBB key stays on the server, the browser never sees it.
 */
router.post("/", verifyToken, async (req, res) => {
  if (!process.env.IMGBB_API_KEY) return res.status(500).json({ message: "Image upload is not configured" });
  let image = req.body?.image;
  if (typeof image !== "string" || !image) return res.status(400).json({ message: "image is required" });
  image = image.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, "");
  if (image.length > 9_000_000) return res.status(413).json({ message: "Image is too large (max ~6 MB)" });

  const form = new URLSearchParams();
  form.set("image", image);
  const r = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
    method: "POST",
    body: form,
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.success) {
    return res.status(502).json({ message: json?.error?.message || "Image upload failed" });
  }
  res.json({ url: json.data.display_url || json.data.url });
});

export default router;
