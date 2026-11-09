/*
 * RobotStatistics — приёмник в существующем сайте на Express (или Connect, node:http).
 *
 *   import { createReceiver, nodeHandler } from "./robot-stats-receiver.mjs"
 *   app.use("/robot-stats", nodeHandler(createReceiver({ key: process.env.ROBOT_STATS_KEY })))
 *
 * Ниже — полный рабочий пример. Запуск:  ROBOT_STATS_KEY=… node server.mjs
 */
import express from "express"
import { createReceiver, nodeHandler } from "../robot-stats-receiver.mjs"

const app = express()

// ВАЖНО: подключить ДО express.json() / bodyParser — приёмник сам читает тело запроса
app.use("/robot-stats", nodeHandler(createReceiver({ key: process.env.ROBOT_STATS_KEY })))

app.use(express.static("public")) // ваш сайт

app.listen(process.env.PORT || 3000, () => console.log("сайт запущен"))
