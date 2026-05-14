import express from "express";
import {
  ObjectLog,
  SessionPool,
  gemstoneExpress,
  type RequestScope,
  type Session,
} from "gemstone-js";

declare global {
  namespace Express {
    interface Request {
      gemstoneScope?: RequestScope;
      gemstoneSession?: Session;
    }
  }
}

const pool = new SessionPool({
  name: "express-web",
  minSize: 1,
  maxSize: 4,
  validationQuery: "1 + 1",
});

await pool.warm();

const app = express();
app.use(gemstoneExpress({ pool, serverErrorStatus: 500 }));

app.get("/health/gemstone", async (req, res, next) => {
  try {
    const stone = await req.gemstoneSession!.eval("System stoneName");
    res.json({
      ok: true,
      stone,
      pool: pool.snapshot(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/object-log", express.json(), async (req, res, next) => {
  try {
    const label = String(req.body?.label ?? "gemstone-js express event");
    await new ObjectLog(req.gemstoneSession!).info(label);
    res.status(201).json({ ok: true, label });
  } catch (error) {
    next(error);
  }
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`Express GemStone example listening on http://localhost:${port}`);
});

async function shutdown() {
  server.close();
  await pool.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
