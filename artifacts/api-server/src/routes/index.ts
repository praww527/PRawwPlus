import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import callsRouter from "./calls";
import paymentsRouter from "./payments";
import numbersRouter from "./numbers";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(callsRouter);
router.use(paymentsRouter);
router.use(numbersRouter);
router.use(adminRouter);

export default router;
