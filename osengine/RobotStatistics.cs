/*
 * RobotStatistics — публикация статистики роботов OsEngine для сайта.
 * https://github.com/si0683/robotstatistics
 *
 * Установка: положить файл в папку OsEngine\Custom\Robots\ и перезапустить OsEngine.
 * В терминале (или тестере) добавить робота «RobotStatistics», открыть его параметры
 * и нажать «Выбрать роботов…».
*/

using OsEngine.Entity;
using OsEngine.Journal.Internal;
using OsEngine.Logging;
using OsEngine.Market;
using OsEngine.Market.Servers;
using OsEngine.Market.Servers.Tester;
using OsEngine.OsTrader;
using OsEngine.OsTrader.Panels;
using OsEngine.OsTrader.Panels.Attributes;
using OsEngine.Themes;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

/* Description
Service robot. Does not trade.

Terminal: every N seconds reads the journals of the selected robots and publishes
  robots.json, <robot>/stats.json, deals.json, deals.csv, stats.csv, deals.rss.
Tester: after each test run publishes the same files into tester/runs/<run>/ and the run list tester/runs.json.

Where: to a folder (default Engine\RobotStatistics\), via HTTP on a port, and/or POST to a webhook URL.
Robots are chosen in a list (button "Выбрать роботов…" or the robot's individual settings).
Statistics are calculated by PositionStatisticGenerator, the same code as the OsEngine Journal.
*/

namespace OsEngine.Robots
{
    [Bot("RobotStatistics")]
    public class RobotStatistics : BotPanel
    {
        #region Constructors

        public RobotStatistics(string name, StartProgram startProgram) : base(name, startProgram)
        {
            _regime = CreateParameter("Режим", "On", new[] { "On", "Off" }, "Основное");
            _chooseButton = CreateParameterButton("Выбрать роботов…", "Основное");
            _interval = CreateParameter("Обновлять каждые, сек", 30, 5, 600, 5, "Основное");
            _publishNowButton = CreateParameterButton("Обновить сейчас", "Основное");

            _formatStatsJson = CreateParameter("stats.json — итоги, статистика, графики", true, "Форматы");
            _formatDealsJson = CreateParameter("deals.json — все сделки", true, "Форматы");
            _formatDealsCsv = CreateParameter("deals.csv — все сделки таблицей", true, "Форматы");
            _formatStatsCsv = CreateParameter("stats.csv — статистика таблицей", true, "Форматы");
            _formatDealsRss = CreateParameter("deals.rss — лента сделок", true, "Форматы");
            _csvSeparator = CreateParameter("Разделитель CSV", ";", new[] { ";", "," }, "Форматы");
            _lastDealsCount = CreateParameter("Последних сделок в stats.json и RSS", 50, 0, 1000, 10, "Форматы");

            _writeFiles = CreateParameter("Записывать файлы в папку", true, "Куда");
            _folder = CreateParameter("Папка (пусто = Engine\\RobotStatistics)", "", "Куда");
            _httpPort = CreateParameter("HTTP порт (0 = выключен)", 0, 0, 65535, 1, "Куда");
            _httpAllAddresses = CreateParameter("HTTP: доступ с других компьютеров", false, "Куда");
            _webhookUrl = CreateParameter("Отправлять на адрес (webhook), пусто = нет", "", "Куда");
            _webhookKey = CreateParameter("Ключ для webhook", "", "Куда");

            _keepRuns = CreateParameter("Тестер: хранить прогонов", 20, 1, 500, 1, "Тестер");

            _showMoney = CreateParameter("Показывать суммы в деньгах", true, "Приватность");
            _showVolume = CreateParameter("Показывать объём позиций", false, "Приватность");
            _openPositionsMode = CreateParameter("Открытые позиции", "Сразу", new[] { "Сразу", "Только после закрытия", "Не показывать" }, "Приватность");
            _showStops = CreateParameter("Показывать стоп и тейк", true, "Приватность");
            _showSignals = CreateParameter("Показывать сигналы робота", true, "Приватность");

            _chooseButton.UserClickOnButtonEvent += ChooseButton_UserClickOnButtonEvent;
            _publishNowButton.UserClickOnButtonEvent += PublishNowButton_UserClickOnButtonEvent;

            DeleteEvent += RobotStatistics_DeleteEvent;

            Description = "Не торгует. Публикует статистику выбранных роботов (терминал — постоянно, тестер — после каждого прогона): stats.json, deals.json, deals.csv, stats.csv, deals.rss — в папку, по HTTP и/или на адрес сайта.";

            LoadChoice();

            // тема OsEngine — для сайта (data-theme="osengine"); при смене темы публикуем сразу
            RefreshTheme();
            ThemeManager.ThemeChangedEvent += ThemeManager_ThemeChangedEvent;

            if (startProgram == StartProgram.IsOsTrader)
            {
                _timer = new Timer(Timer_Tick, null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(1));
            }
            else if (startProgram == StartProgram.IsTester)
            {
                SubscribeTester();
                _timer = new Timer(Timer_Tick, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1));
            }
        }

        public override string GetNameStrategyType()
        {
            return "RobotStatistics";
        }

        public override void ShowIndividualSettingsDialog()
        {
            ShowChooseWindow();
        }

        #endregion

        #region Parameters

        private StrategyParameterString _regime;
        private StrategyParameterButton _chooseButton;
        private StrategyParameterInt _interval;
        private StrategyParameterButton _publishNowButton;

        private StrategyParameterBool _formatStatsJson;
        private StrategyParameterBool _formatDealsJson;
        private StrategyParameterBool _formatDealsCsv;
        private StrategyParameterBool _formatStatsCsv;
        private StrategyParameterBool _formatDealsRss;
        private StrategyParameterString _csvSeparator;
        private StrategyParameterInt _lastDealsCount;

        private StrategyParameterBool _writeFiles;
        private StrategyParameterString _folder;
        private StrategyParameterInt _httpPort;
        private StrategyParameterBool _httpAllAddresses;
        private StrategyParameterString _webhookUrl;
        private StrategyParameterString _webhookKey;

        private StrategyParameterInt _keepRuns;

        private StrategyParameterBool _showMoney;
        private StrategyParameterBool _showVolume;
        private StrategyParameterString _openPositionsMode;
        private StrategyParameterBool _showStops;
        private StrategyParameterBool _showSignals;

        private bool IsOn
        {
            // "Включено" — значение из прежних версий, чтобы после обновления робот не выключился
            get { return _regime.ValueString == "On" || _regime.ValueString == "Включено"; }
        }

        #endregion

        #region Robot choice

        // Выбор роботов хранится в своём файле: Engine\<имя>RobotStatisticsBots.txt
        // 1-я строка: all | list; дальше: имя \t 1/0 \t подпись на сайте

        private readonly object _choiceLocker = new object();

        private bool _publishAll = true;

        private Dictionary<string, RobotStatisticsChoice> _choices = new Dictionary<string, RobotStatisticsChoice>();

        private string ChoiceFile
        {
            get { return Path.Combine("Engine", NameStrategyUniq + "RobotStatisticsBots.txt"); }
        }

        private void LoadChoice()
        {
            try
            {
                if (!File.Exists(ChoiceFile))
                {
                    return;
                }

                string[] lines = File.ReadAllLines(ChoiceFile, Encoding.UTF8);
                Dictionary<string, RobotStatisticsChoice> choices = new Dictionary<string, RobotStatisticsChoice>();

                for (int i = 1; i < lines.Length; i++)
                {
                    string[] parts = lines[i].Split('\t');

                    if (parts.Length < 2 || parts[0] == "")
                    {
                        continue;
                    }

                    RobotStatisticsChoice choice = new RobotStatisticsChoice();
                    choice.Name = parts[0];
                    choice.Selected = parts[1] == "1";
                    choice.PublicName = parts.Length > 2 ? parts[2] : "";
                    choices[choice.Name] = choice;
                }

                lock (_choiceLocker)
                {
                    _publishAll = lines.Length == 0 || lines[0].Trim() != "list";
                    _choices = choices;
                }
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: не удалось прочитать выбор роботов: " + error.Message, LogMessageType.Error);
            }
        }

        private void SaveChoice()
        {
            try
            {
                StringBuilder text = new StringBuilder();

                lock (_choiceLocker)
                {
                    text.Append(_publishAll ? "all" : "list").Append("\r\n");

                    foreach (RobotStatisticsChoice choice in _choices.Values)
                    {
                        text.Append(choice.Name.Replace("\t", " ")).Append('\t')
                            .Append(choice.Selected ? "1" : "0").Append('\t')
                            .Append((choice.PublicName ?? "").Replace("\t", " ").Replace("\r", "").Replace("\n", ""))
                            .Append("\r\n");
                    }
                }

                File.WriteAllText(ChoiceFile, text.ToString(), Encoding.UTF8);
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: не удалось сохранить выбор роботов: " + error.Message, LogMessageType.Error);
            }
        }

        private void ShowChooseWindow()
        {
            try
            {
                System.Windows.Application app = System.Windows.Application.Current;

                if (app == null)
                {
                    return;
                }

                app.Dispatcher.Invoke(() =>
                {
                    List<BotPanel> bots = GetAllBots();
                    List<RobotStatisticsChoice> rows = new List<RobotStatisticsChoice>();
                    bool publishAll;

                    lock (_choiceLocker)
                    {
                        publishAll = _publishAll;

                        for (int i = 0; i < bots.Count; i++)
                        {
                            RobotStatisticsChoice saved;
                            _choices.TryGetValue(bots[i].NameStrategyUniq, out saved);

                            RobotStatisticsChoice row = new RobotStatisticsChoice();
                            row.Name = bots[i].NameStrategyUniq;
                            row.Type = bots[i].GetNameStrategyType();
                            row.Selected = saved != null && saved.Selected;
                            row.PublicName = saved != null ? saved.PublicName : "";
                            rows.Add(row);
                        }
                    }

                    RobotStatisticsChooseUi ui = new RobotStatisticsChooseUi(rows, publishAll);

                    if (ui.ShowDialog() != true)
                    {
                        return;
                    }

                    lock (_choiceLocker)
                    {
                        _publishAll = ui.PublishAll;

                        for (int i = 0; i < ui.Rows.Count; i++)
                        {
                            _choices[ui.Rows[i].Name] = ui.Rows[i];
                        }
                    }

                    SaveChoice();
                    _lastPublishTime = DateTime.MinValue;
                });
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: " + error, LogMessageType.Error);
            }
        }

        private string GetPublicName(string botName)
        {
            lock (_choiceLocker)
            {
                RobotStatisticsChoice choice;

                if (_choices.TryGetValue(botName, out choice) && !string.IsNullOrWhiteSpace(choice.PublicName))
                {
                    return choice.PublicName.Trim();
                }
            }

            return botName;
        }

        #endregion

        #region Event handlers

        private void ChooseButton_UserClickOnButtonEvent()
        {
            ShowChooseWindow();
        }

        private void PublishNowButton_UserClickOnButtonEvent()
        {
            _lastPublishTime = DateTime.MinValue;
        }

        private void RobotStatistics_DeleteEvent()
        {
            try
            {
                _isDeleted = true;
                _timer?.Dispose();
                _timer = null;
                StopListener();

                if (_testerServer != null)
                {
                    _testerServer.TestingEndEvent -= TesterServer_TestingEndEvent;
                    _testerServer = null;
                }

                ThemeManager.ThemeChangedEvent -= ThemeManager_ThemeChangedEvent;

                if (File.Exists(ChoiceFile))
                {
                    File.Delete(ChoiceFile);
                }
            }
            catch (Exception error)
            {
                SendNewLogMessage(error.ToString(), LogMessageType.Error);
            }
        }

        private void Timer_Tick(object state)
        {
            if (_isDeleted)
            {
                return;
            }

            if (Interlocked.Exchange(ref _isWorking, 1) == 1)
            {
                return;
            }

            try
            {
                if (!IsOn)
                {
                    StopListener();
                    return;
                }

                EnsureListener();

                if (StartProgram != StartProgram.IsOsTrader)
                {
                    return; // в тестере публикация — по окончании прогона
                }

                if (DateTime.Now - _lastPublishTime < TimeSpan.FromSeconds(_interval.ValueInt))
                {
                    return;
                }

                _lastPublishTime = DateTime.Now;

                PublishTerminal();
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: " + error, LogMessageType.Error);
            }
            finally
            {
                Interlocked.Exchange(ref _isWorking, 0);
            }
        }

        #endregion

        #region Terminal publishing

        private Timer _timer;

        private int _isWorking;

        private bool _isDeleted;

        private DateTime _lastPublishTime = DateTime.MinValue;

        private string _lastWebhookHash = "";

        private void PublishTerminal()
        {
            Dictionary<string, byte[]> files = BuildFiles("terminal", null, null);

            lock (_cacheLocker)
            {
                _cache = files;
            }

            if (_writeFiles.ValueBool)
            {
                WriteFiles(GetRootFolder(), files);
            }

            string hash = HashFiles(files);

            if (hash != _lastWebhookHash && SendWebhook("terminal", null, files))
            {
                _lastWebhookHash = hash;
            }
        }

        #endregion

        #region Tester publishing

        private TesterServer _testerServer;

        private void SubscribeTester()
        {
            try
            {
                List<IServer> servers = ServerMaster.GetServers();

                if (servers == null)
                {
                    return;
                }

                for (int i = 0; i < servers.Count; i++)
                {
                    if (servers[i] is TesterServer tester)
                    {
                        _testerServer = tester;
                        _testerServer.TestingEndEvent += TesterServer_TestingEndEvent;
                        return;
                    }
                }
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: тестер не найден: " + error.Message, LogMessageType.Error);
            }
        }

        private void TesterServer_TestingEndEvent()
        {
            if (_isDeleted || !IsOn)
            {
                return;
            }

            try
            {
                PublishTesterRun();
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: тестер: " + error, LogMessageType.Error);
            }
        }

        private void PublishTesterRun()
        {
            DateTime finished = DateTime.Now;
            string runId = finished.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture);

            Dictionary<string, object> testerInfo = new Dictionary<string, object>();
            testerInfo["run"] = runId;

            if (_testerServer != null)
            {
                testerInfo["from"] = FormatTime(_testerServer.TimeStart);
                testerInfo["to"] = FormatTime(_testerServer.TimeEnd);
                testerInfo["set"] = _testerServer.ActiveSet ?? "";
            }

            List<Dictionary<string, object>> index = new List<Dictionary<string, object>>();
            Dictionary<string, byte[]> runFiles = BuildFiles("tester", testerInfo, index);

            if (index.Count == 0)
            {
                SendNewLogMessage("RobotStatistics: прогон тестера закончен, но выбранных роботов нет — нажмите «Выбрать роботов…»", LogMessageType.Error);
                return;
            }

            string root = Path.Combine(GetRootFolder(), "tester");
            string runsJsonPath = Path.Combine(root, "runs.json");

            // список прогонов: новый сверху, лишние удаляем
            List<Dictionary<string, object>> runs = ReadRuns(runsJsonPath);

            Dictionary<string, object> run = new Dictionary<string, object>();
            run["id"] = runId;
            run["title"] = finished.ToString("dd.MM.yy HH:mm:ss", CultureInfo.InvariantCulture)
                + (_testerServer != null && _testerServer.TimeStart != DateTime.MinValue
                    ? " · " + _testerServer.TimeStart.ToString("dd.MM.yy", CultureInfo.InvariantCulture)
                      + " — " + _testerServer.TimeEnd.ToString("dd.MM.yy", CultureInfo.InvariantCulture)
                    : "");
            run["finished_at"] = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
            run["robots"] = "runs/" + runId + "/robots.json";
            run["summary"] = index;
            runs.Insert(0, run);

            List<string> removed = new List<string>();

            while (runs.Count > Math.Max(1, _keepRuns.ValueInt))
            {
                removed.Add(runs[runs.Count - 1]["id"].ToString());
                runs.RemoveAt(runs.Count - 1);
            }

            Dictionary<string, object> runsDocument = new Dictionary<string, object>();
            runsDocument["schema"] = 1;
            runsDocument["source"] = "tester";
            runsDocument["generated_at"] = run["finished_at"];
            runsDocument["runs"] = runs;

            Dictionary<string, byte[]> files = new Dictionary<string, byte[]>();

            foreach (KeyValuePair<string, byte[]> file in runFiles)
            {
                files["runs/" + runId + "/" + file.Key] = file.Value;
            }

            files["runs.json"] = ToJson(runsDocument);

            if (_writeFiles.ValueBool)
            {
                WriteFiles(root, files);

                for (int i = 0; i < removed.Count; i++)
                {
                    try
                    {
                        string dir = Path.Combine(root, "runs", removed[i]);

                        if (Directory.Exists(dir))
                        {
                            Directory.Delete(dir, true);
                        }
                    }
                    catch
                    {
                        // ignore
                    }
                }
            }

            lock (_cacheLocker)
            {
                Dictionary<string, byte[]> cache = new Dictionary<string, byte[]>(_cache);

                foreach (string key in cache.Keys.ToList())
                {
                    for (int i = 0; i < removed.Count; i++)
                    {
                        if (key.StartsWith("tester/runs/" + removed[i] + "/"))
                        {
                            cache.Remove(key);
                        }
                    }
                }

                foreach (KeyValuePair<string, byte[]> file in files)
                {
                    cache["tester/" + file.Key] = file.Value;
                }

                _cache = cache;
            }

            Dictionary<string, byte[]> webhookFiles = new Dictionary<string, byte[]>();

            foreach (KeyValuePair<string, byte[]> file in files)
            {
                webhookFiles["tester/" + file.Key] = file.Value;
            }

            SendWebhook("tester", runId, webhookFiles, removed);

            SendNewLogMessage("RobotStatistics: прогон тестера " + runId + " опубликован (" + index.Count + " роб.) → " + root, LogMessageType.System);
        }

        private List<Dictionary<string, object>> ReadRuns(string path)
        {
            List<Dictionary<string, object>> runs = new List<Dictionary<string, object>>();

            try
            {
                if (!File.Exists(path))
                {
                    return runs;
                }

                using (JsonDocument doc = JsonDocument.Parse(File.ReadAllBytes(path)))
                {
                    JsonElement list;

                    if (!doc.RootElement.TryGetProperty("runs", out list) || list.ValueKind != JsonValueKind.Array)
                    {
                        return runs;
                    }

                    foreach (JsonElement item in list.EnumerateArray())
                    {
                        Dictionary<string, object> run = JsonSerializer.Deserialize<Dictionary<string, object>>(item.GetRawText());

                        if (run != null && run.ContainsKey("id"))
                        {
                            runs.Add(run);
                        }
                    }
                }
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: runs.json повреждён, начинаю список заново: " + error.Message, LogMessageType.Error);
            }

            return runs;
        }

        #endregion

        #region Building files

        // Собирает файлы всех выбранных роботов. Пути относительные: robots.json, <slug>/stats.json, ...
        private Dictionary<string, byte[]> BuildFiles(string source, Dictionary<string, object> testerInfo, List<Dictionary<string, object>> indexOut)
        {
            List<BotPanel> bots = GetSelectedBots();
            Dictionary<string, byte[]> files = new Dictionary<string, byte[]>();
            List<Dictionary<string, object>> index = new List<Dictionary<string, object>>();
            HashSet<string> usedSlugs = new HashSet<string>();
            string generatedAt = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);

            for (int i = 0; i < bots.Count; i++)
            {
                BotPanel bot = bots[i];

                try
                {
                    string slug = MakeSlug(bot.NameStrategyUniq);

                    while (usedSlugs.Contains(slug))
                    {
                        slug += "-" + (i + 1);
                    }

                    usedSlugs.Add(slug);

                    string publicName = GetPublicName(bot.NameStrategyUniq);

                    List<Position> all = GetPositions(bot);
                    List<Position> closed = all.FindAll(p => p.State == PositionStateType.Done);
                    List<Position> open = all.FindAll(p => p.State != PositionStateType.Done
                                                         && p.State != PositionStateType.OpeningFail
                                                         && p.State != PositionStateType.Deleted);

                    Dictionary<string, object> stats = BuildStatistics(all);
                    Dictionary<string, object> statsAll = (Dictionary<string, object>)stats["all"];

                    Dictionary<string, string> links = new Dictionary<string, string>();

                    if (_formatStatsJson.ValueBool)
                    {
                        Dictionary<string, object> doc = BuildStatsDocument(slug, publicName, bot, generatedAt, all, closed, open, stats);
                        doc["source"] = source;

                        if (testerInfo != null)
                        {
                            doc["tester"] = testerInfo;
                            ((Dictionary<string, object>)doc["status"])["terminal"] = "tester";
                        }

                        files[slug + "/stats.json"] = ToJson(doc);
                        links["stats_json"] = slug + "/stats.json";
                    }

                    if (_formatDealsJson.ValueBool)
                    {
                        files[slug + "/deals.json"] = ToJson(BuildDealsDocument(slug, publicName, generatedAt, closed));
                        links["deals_json"] = slug + "/deals.json";
                    }

                    if (_formatDealsCsv.ValueBool)
                    {
                        files[slug + "/deals.csv"] = BuildDealsCsv(closed);
                        links["deals_csv"] = slug + "/deals.csv";
                    }

                    if (_formatStatsCsv.ValueBool)
                    {
                        files[slug + "/stats.csv"] = BuildStatsCsv(stats);
                        links["stats_csv"] = slug + "/stats.csv";
                    }

                    if (_formatDealsRss.ValueBool)
                    {
                        files[slug + "/deals.rss"] = BuildRss(slug, publicName, closed);
                        links["deals_rss"] = slug + "/deals.rss";
                    }

                    Dictionary<string, object> indexItem = new Dictionary<string, object>();
                    indexItem["slug"] = slug;
                    indexItem["name"] = publicName;
                    indexItem["type"] = bot.GetNameStrategyType();
                    indexItem["net_profit_percent"] = statsAll["net_profit_percent"];

                    if (_showMoney.ValueBool)
                    {
                        indexItem["net_profit"] = statsAll["net_profit"];
                    }

                    indexItem["deals_count"] = closed.Count;
                    indexItem["open_count"] = open.Count;
                    indexItem["files"] = links;
                    index.Add(indexItem);
                }
                catch (Exception error)
                {
                    SendNewLogMessage("RobotStatistics: робот " + bot.NameStrategyUniq + ": " + error.Message, LogMessageType.Error);
                }
            }

            Dictionary<string, object> robotsDocument = new Dictionary<string, object>();
            robotsDocument["schema"] = 1;
            robotsDocument["source"] = source;
            robotsDocument["generated_at"] = generatedAt;
            robotsDocument["theme"] = GetThemeInfo();
            robotsDocument["robots"] = index;
            files["robots.json"] = ToJson(robotsDocument);

            if (indexOut != null)
            {
                indexOut.AddRange(index);
            }

            return files;
        }

        private void WriteFiles(string root, Dictionary<string, byte[]> files)
        {
            foreach (KeyValuePair<string, byte[]> file in files)
            {
                try
                {
                    string path = Path.Combine(root, file.Key.Replace('/', Path.DirectorySeparatorChar));
                    string directory = Path.GetDirectoryName(path);

                    if (!Directory.Exists(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }

                    if (File.Exists(path) && File.ReadAllBytes(path).SequenceEqual(file.Value))
                    {
                        continue; // не трогаем неизменившиеся файлы — синхронизатор не будет гонять их зря
                    }

                    string temp = path + ".tmp";
                    File.WriteAllBytes(temp, file.Value);
                    File.Move(temp, path, true);
                }
                catch (Exception error)
                {
                    SendNewLogMessage("RobotStatistics: не удалось записать " + file.Key + ": " + error.Message, LogMessageType.Error);
                }
            }
        }

        private string GetRootFolder()
        {
            string folder = _folder.ValueString;

            if (string.IsNullOrWhiteSpace(folder))
            {
                folder = Path.Combine("Engine", "RobotStatistics");
            }

            return Path.GetFullPath(folder.Trim());
        }

        private static string HashFiles(Dictionary<string, byte[]> files)
        {
            using (IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA1))
            {
                foreach (string key in files.Keys.OrderBy(k => k, StringComparer.Ordinal))
                {
                    hash.AppendData(Encoding.UTF8.GetBytes(key));
                    hash.AppendData(files[key]);
                }

                return Convert.ToHexString(hash.GetHashAndReset());
            }
        }

        #endregion

        #region Webhook

        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

        // POST {schema, source, run, generated_at, files:{"путь": "текст"}, removed_runs:[...]}
        // Приёмник раскладывает файлы по путям и удаляет папки tester/runs/<id> из removed_runs
        private bool SendWebhook(string source, string runId, Dictionary<string, byte[]> files, List<string> removedRuns = null)
        {
            string url = (_webhookUrl.ValueString ?? "").Trim();

            if (url == "")
            {
                return false;
            }

            try
            {
                Dictionary<string, string> texts = new Dictionary<string, string>();
                byte[] bom = Encoding.UTF8.GetPreamble();

                foreach (KeyValuePair<string, byte[]> file in files)
                {
                    byte[] body = file.Value;
                    int offset = body.Length >= 3 && body[0] == bom[0] && body[1] == bom[1] && body[2] == bom[2] ? 3 : 0;
                    texts[file.Key] = Encoding.UTF8.GetString(body, offset, body.Length - offset);
                }

                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["schema"] = 1;
                payload["source"] = source;
                payload["run"] = runId;
                payload["generated_at"] = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
                payload["files"] = texts;
                payload["removed_runs"] = removedRuns ?? new List<string>();

                using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    request.Content = new ByteArrayContent(ToJson(payload));
                    request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };

                    string key = (_webhookKey.ValueString ?? "").Trim();

                    if (key != "")
                    {
                        request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + key);
                    }

                    using (HttpResponseMessage response = _http.SendAsync(request).GetAwaiter().GetResult())
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            SendNewLogMessage("RobotStatistics: webhook " + url + " ответил " + (int)response.StatusCode, LogMessageType.Error);
                            return false;
                        }
                    }
                }

                return true;
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: webhook " + url + " недоступен: " + error.Message, LogMessageType.Error);
                return false;
            }
        }

        #endregion

        #region Theme

        // Текущая тема OsEngine для сайта: id, название и цвета (работает и для пользовательских тем из Engine\Themes)
        private Dictionary<string, object> _theme;

        private readonly object _themeLocker = new object();

        private void ThemeManager_ThemeChangedEvent()
        {
            RefreshTheme();
            _lastPublishTime = DateTime.MinValue; // сайт перекрасится при ближайшей публикации, не дожидаясь таймера
        }

        private void RefreshTheme()
        {
            try
            {
                System.Windows.Application app = System.Windows.Application.Current;

                if (app == null)
                {
                    return;
                }

                Dictionary<string, object> theme = null;

                // ресурсы темы читаются только из потока интерфейса
                app.Dispatcher.Invoke(() =>
                {
                    Dictionary<string, object> colors = new Dictionary<string, object>();
                    colors["bg"] = ToHex(ThemeManager.GetColor("StandardBackGroundColor"));
                    colors["card"] = ToHex(ThemeManager.GetColor("StandardBackGroundColorLight"));
                    colors["text"] = ToHex(ThemeManager.GetColor("ControlForegroundWhite"));
                    colors["muted"] = ToHex(ThemeManager.GetColor("TextSecondaryBrush"));
                    colors["accent"] = ToHex(ThemeManager.GetColor("LabelForegroundBrush"));
                    colors["line"] = ToHex(ThemeManager.GetColor("ChartBorderColor"));

                    System.Windows.Media.Color bg = ThemeManager.GetColor("StandardBackGroundColor");
                    double luminance = (0.2126 * bg.R + 0.7152 * bg.G + 0.0722 * bg.B) / 255.0;

                    theme = new Dictionary<string, object>();
                    theme["id"] = ThemeManager.CurrentTheme;
                    theme["name"] = ThemeManager.GetString("ThemeDisplayName");
                    theme["dark"] = luminance < 0.5;
                    theme["colors"] = colors;
                });

                lock (_themeLocker)
                {
                    _theme = theme;
                }
            }
            catch (Exception error)
            {
                SendNewLogMessage("RobotStatistics: тема OsEngine не прочитана: " + error.Message, LogMessageType.Error);
            }
        }

        private Dictionary<string, object> GetThemeInfo()
        {
            lock (_themeLocker)
            {
                return _theme;
            }
        }

        private static string ToHex(System.Windows.Media.Color c)
        {
            return "#" + c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
        }

        #endregion

        #region Robots and positions

        private List<BotPanel> GetAllBots()
        {
            List<BotPanel> result = new List<BotPanel>();

            OsTraderMaster master = OsTraderMaster.Master;

            if (master == null || master.PanelsArray == null)
            {
                return result;
            }

            BotPanel[] panels = master.PanelsArray.ToArray();

            for (int i = 0; i < panels.Length; i++)
            {
                if (panels[i] == null || panels[i] == this || panels[i] is RobotStatistics)
                {
                    continue;
                }

                result.Add(panels[i]);
            }

            return result;
        }

        private List<BotPanel> GetSelectedBots()
        {
            List<BotPanel> all = GetAllBots();

            lock (_choiceLocker)
            {
                if (_publishAll)
                {
                    return all;
                }

                return all.FindAll(b => _choices.ContainsKey(b.NameStrategyUniq) && _choices[b.NameStrategyUniq].Selected);
            }
        }

        private List<Position> GetPositions(BotPanel bot)
        {
            List<Position> result = new List<Position>();

            List<Journal.Journal> journals = bot.GetJournals();

            if (journals == null)
            {
                return result;
            }

            for (int i = 0; i < journals.Count; i++)
            {
                if (journals[i] == null)
                {
                    continue;
                }

                List<Position> positions = journals[i].AllPosition;

                if (positions == null)
                {
                    continue;
                }

                Position[] copy = positions.ToArray(); // список меняет торговый поток — работаем с копией

                for (int j = 0; j < copy.Length; j++)
                {
                    if (copy[j] != null && copy[j].State != PositionStateType.OpeningFail)
                    {
                        result.Add(copy[j]);
                    }
                }
            }

            return result.OrderBy(p => p.TimeOpen).ToList();
        }

        #endregion

        #region Documents

        private Dictionary<string, object> BuildStatsDocument(string slug, string publicName, BotPanel bot, string generatedAt,
            List<Position> all, List<Position> closed, List<Position> open, Dictionary<string, object> stats)
        {
            bool money = _showMoney.ValueBool;

            Dictionary<string, object> doc = new Dictionary<string, object>();
            doc["schema"] = 1;
            doc["slug"] = slug;
            doc["name"] = publicName;
            doc["type"] = bot.GetNameStrategyType();
            doc["generated_at"] = generatedAt;
            doc["money_shown"] = money;
            doc["theme"] = GetThemeInfo();

            Dictionary<string, object> status = new Dictionary<string, object>();
            status["terminal"] = "online";
            status["last_trade_time"] = closed.Count > 0 ? FormatTime(closed.Max(p => p.TimeClose)) : null;
            doc["status"] = status;

            Dictionary<string, object> statsAll = (Dictionary<string, object>)stats["all"];
            Dictionary<string, object> summary = new Dictionary<string, object>();

            if (money)
            {
                summary["net_profit"] = statsAll["net_profit"];
            }

            summary["net_profit_percent"] = statsAll["net_profit_percent"];
            summary["deals_count"] = closed.Count;
            summary["open_count"] = open.Count;

            if (_showStops.ValueBool && all.Any(p => p.StopOrderPrice > 0 || p.ProfitOrderPrice > 0))
            {
                summary["closed_by_stop"] = closed.Count(p => GetExitBy(p) == "stop");
                summary["closed_by_take"] = closed.Count(p => GetExitBy(p) == "take");
            }

            summary["period_from"] = all.Count > 0 ? FormatTime(all[0].TimeOpen) : null;
            summary["period_to"] = closed.Count > 0 ? FormatTime(closed.Max(p => p.TimeClose)) : null;
            doc["summary"] = summary;

            doc["statistics"] = stats;

            // Точки кривой — по времени (закрытия, у открытой позиции — открытия), иначе время на графике «прыгает» назад
            List<Position> byPointTime = all.OrderBy(p => GetPointTime(p)).ToList();
            doc["equity"] = BuildEquity(byPointTime, money);
            doc["drawdown"] = BuildDrawdown(byPointTime, money);

            string openMode = _openPositionsMode.ValueString;

            if (openMode == "Сразу")
            {
                doc["open_positions"] = open.Select(p => DealToObject(p, false)).ToList();
            }
            else if (openMode == "Только после закрытия")
            {
                doc["open_positions"] = new List<object>();
            }

            int lastCount = Math.Max(0, _lastDealsCount.ValueInt);
            doc["last_deals"] = closed.OrderByDescending(p => p.TimeClose).Take(lastCount).Select(p => DealToObject(p, true)).ToList();

            return doc;
        }

        private Dictionary<string, object> BuildDealsDocument(string slug, string publicName, string generatedAt, List<Position> closed)
        {
            Dictionary<string, object> doc = new Dictionary<string, object>();
            doc["schema"] = 1;
            doc["slug"] = slug;
            doc["name"] = publicName;
            doc["generated_at"] = generatedAt;
            doc["money_shown"] = _showMoney.ValueBool;
            doc["count"] = closed.Count;
            doc["deals"] = closed.OrderBy(p => p.TimeClose).Select(p => DealToObject(p, true)).ToList();
            return doc;
        }

        private Dictionary<string, object> DealToObject(Position pos, bool isClosed)
        {
            Dictionary<string, object> deal = new Dictionary<string, object>();
            deal["number"] = pos.Number;
            deal["security"] = pos.SecurityName ?? "";
            deal["direction"] = pos.Direction == Side.Buy ? "Long" : "Short";
            deal["open_time"] = FormatTime(pos.TimeOpen);

            if (isClosed)
            {
                deal["close_time"] = FormatTime(pos.TimeClose);
            }

            deal["entry_price"] = pos.EntryPrice;

            if (isClosed)
            {
                deal["close_price"] = pos.ClosePrice;
            }

            if (_showVolume.ValueBool)
            {
                deal["volume"] = isClosed ? pos.MaxVolume : pos.OpenVolume;
            }

            deal["profit_percent"] = Math.Round(pos.ProfitOperationPercent, 4);
            deal["profit_points"] = Math.Round(pos.ProfitOperationAbs, 6);

            if (_showStops.ValueBool)
            {
                // у открытой позиции — текущие уровни (с учётом трейлинга), у закрытой — последние перед выходом
                if (pos.StopOrderPrice > 0)
                {
                    deal["stop_price"] = pos.StopOrderPrice;
                }

                if (pos.ProfitOrderPrice > 0)
                {
                    deal["take_price"] = pos.ProfitOrderPrice;
                }

                if (isClosed)
                {
                    string exitBy = GetExitBy(pos);

                    if (exitBy != null)
                    {
                        deal["exit_by"] = exitBy;
                    }
                }
            }

            if (_showSignals.ValueBool)
            {
                if (!string.IsNullOrWhiteSpace(pos.SignalTypeOpen))
                {
                    deal["signal_open"] = pos.SignalTypeOpen.Trim();
                }

                if (isClosed && !string.IsNullOrWhiteSpace(pos.SignalTypeClose))
                {
                    deal["signal_close"] = pos.SignalTypeClose.Trim();
                }
            }

            if (_showMoney.ValueBool)
            {
                deal["profit_abs"] = Math.Round(pos.ProfitPortfolioAbs, 4);
                deal["commission"] = Math.Round(pos.CommissionTotal(), 4);
            }

            return deal;
        }

        // Причина выхода. Отдельного флага в OsEngine нет: сначала смотрим подпись сигнала закрытия
        // (BotTabSimple при срабатывании стопа пишет туда SignalTypeStop, если робот её задал),
        // иначе — близость цены закрытия к уровню стопа/тейка (3 шага цены или 0,3 %, что больше).
        private static string GetExitBy(Position pos)
        {
            if (pos.State != PositionStateType.Done || pos.ClosePrice <= 0)
            {
                return null;
            }

            if (!string.IsNullOrEmpty(pos.SignalTypeClose))
            {
                if (pos.SignalTypeClose == pos.SignalTypeStop)
                {
                    return "stop";
                }

                if (pos.SignalTypeClose == pos.SignalTypeProfit)
                {
                    return "take";
                }
            }

            decimal tolerance = Math.Max(pos.PriceStep * 3, pos.ClosePrice * 0.003m);
            decimal toStop = pos.StopOrderPrice > 0 ? Math.Abs(pos.ClosePrice - pos.StopOrderPrice) : decimal.MaxValue;
            decimal toTake = pos.ProfitOrderPrice > 0 ? Math.Abs(pos.ClosePrice - pos.ProfitOrderPrice) : decimal.MaxValue;

            if (toStop <= tolerance && toStop <= toTake)
            {
                return "stop";
            }

            if (toTake <= tolerance)
            {
                return "take";
            }

            return null;
        }

        private Dictionary<string, object> BuildStatistics(List<Position> all)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["all"] = BuildStatisticsBlock(all);
            result["long"] = BuildStatisticsBlock(all.FindAll(p => p.Direction == Side.Buy));
            result["short"] = BuildStatisticsBlock(all.FindAll(p => p.Direction == Side.Sell));
            return result;
        }

        // Те же формулы и тот же набор позиций, что у журнала OsEngine и MCP bot_journal_get_statistics
        private Dictionary<string, object> BuildStatisticsBlock(List<Position> deals)
        {
            Dictionary<string, object> block = new Dictionary<string, object>();
            Position[] array = deals.ToArray();
            bool empty = array.Length == 0;

            block["net_profit"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetAllProfitInAbsolute(array, false), 4);
            block["net_profit_percent"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetAllProfitPercent(array, false), 4);
            block["deals_count"] = empty ? 0 : PositionStatisticGenerator.GetAllDealsCount(array);

            int profitable = empty ? 0 : PositionStatisticGenerator.GetProfitDeal(array);
            block["profitable_deals"] = profitable;
            block["losing_deals"] = array.Length - profitable;
            block["profitable_percent"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetProfitDialPercent(array), 2);
            block["profit_factor"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetProfitFactor(array), 4);
            block["payoff_ratio"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetPayOffRatio(array), 4);
            block["recovery"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetRecovery(array), 4);
            block["sharpe"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetSharpRatio(array, 7), 4);
            block["max_drawdown_percent"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetMaxDownPercent(array), 4);
            block["average_holding_time"] = empty ? "" : PositionStatisticGenerator.GetAverageTimeOnPoses(array);

            if (_showMoney.ValueBool)
            {
                block["commission"] = empty ? 0m : Math.Round(PositionStatisticGenerator.GetCommissionAmount(array), 4);
            }
            else
            {
                block.Remove("net_profit");
            }

            return block;
        }

        // Как MCP bot_journal_get_equity: накопление прибыли × MultToJournal / 100
        private List<object> BuildEquity(List<Position> deals, bool money)
        {
            List<object> points = new List<object>();
            decimal cumulativeAbs = 0;
            decimal cumulativePercent = 0;

            for (int i = 0; i < deals.Count; i++)
            {
                Position pos = deals[i];
                decimal mult = pos.MultToJournal / 100;
                cumulativeAbs += pos.ProfitPortfolioAbs * mult;
                cumulativePercent += pos.ProfitPortfolioPercent * mult;

                Dictionary<string, object> point = new Dictionary<string, object>();
                point["time"] = FormatTime(GetPointTime(pos));
                point["percent"] = Math.Round(cumulativePercent, 4);

                if (money)
                {
                    point["abs"] = Math.Round(cumulativeAbs, 4);
                }

                points.Add(point);
            }

            return points;
        }

        // Как MCP bot_journal_get_drawdown
        private List<object> BuildDrawdown(List<Position> deals, bool money)
        {
            List<object> points = new List<object>();
            decimal cumulative = 0;
            decimal maxEquity = 0;

            for (int i = 0; i < deals.Count; i++)
            {
                Position pos = deals[i];
                cumulative += pos.ProfitPortfolioAbs * (pos.MultToJournal / 100);

                if (cumulative > maxEquity)
                {
                    maxEquity = cumulative;
                }

                decimal absolute = cumulative - maxEquity;
                decimal percent = maxEquity != 0 ? Math.Round(absolute / maxEquity * 100, 4) : 0;

                Dictionary<string, object> point = new Dictionary<string, object>();
                point["time"] = FormatTime(GetPointTime(pos));
                point["percent"] = percent;

                if (money)
                {
                    point["abs"] = Math.Round(absolute, 4);
                }

                points.Add(point);
            }

            return points;
        }

        private static DateTime GetPointTime(Position pos)
        {
            DateTime time = pos.State == PositionStateType.Done ? pos.TimeClose : pos.TimeOpen;

            if (time == DateTime.MinValue)
            {
                time = pos.TimeOpen;
            }

            return time;
        }

        #endregion

        #region Formats

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            WriteIndented = false
        };

        private static byte[] ToJson(object value)
        {
            return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, _jsonOptions));
        }

        private byte[] BuildDealsCsv(List<Position> closed)
        {
            string sep = _csvSeparator.ValueString == "," ? "," : ";";
            bool money = _showMoney.ValueBool;
            bool volume = _showVolume.ValueBool;

            List<string> header = new List<string> { "number", "security", "direction", "open_time", "close_time", "entry_price", "close_price" };

            if (volume)
            {
                header.Add("volume");
            }

            header.Add("profit_percent");

            if (money)
            {
                header.Add("profit_abs");
                header.Add("commission");
            }

            bool stops = _showStops.ValueBool;
            bool signals = _showSignals.ValueBool;

            if (stops)
            {
                header.Add("stop_price");
                header.Add("take_price");
                header.Add("exit_by");
            }

            if (signals)
            {
                header.Add("signal_open");
                header.Add("signal_close");
            }

            StringBuilder csv = new StringBuilder();
            csv.Append(string.Join(sep, header)).Append("\r\n");

            List<Position> ordered = closed.OrderBy(p => p.TimeClose).ToList();

            for (int i = 0; i < ordered.Count; i++)
            {
                Position pos = ordered[i];
                List<string> row = new List<string>
                {
                    pos.Number.ToString(CultureInfo.InvariantCulture),
                    CsvText(pos.SecurityName ?? "", sep),
                    pos.Direction == Side.Buy ? "Long" : "Short",
                    FormatTime(pos.TimeOpen),
                    FormatTime(pos.TimeClose),
                    CsvNumber(pos.EntryPrice, sep),
                    CsvNumber(pos.ClosePrice, sep)
                };

                if (volume)
                {
                    row.Add(CsvNumber(pos.MaxVolume, sep));
                }

                row.Add(CsvNumber(Math.Round(pos.ProfitOperationPercent, 4), sep));

                if (money)
                {
                    row.Add(CsvNumber(Math.Round(pos.ProfitPortfolioAbs, 4), sep));
                    row.Add(CsvNumber(Math.Round(pos.CommissionTotal(), 4), sep));
                }

                if (stops)
                {
                    row.Add(pos.StopOrderPrice > 0 ? CsvNumber(pos.StopOrderPrice, sep) : "");
                    row.Add(pos.ProfitOrderPrice > 0 ? CsvNumber(pos.ProfitOrderPrice, sep) : "");
                    row.Add(GetExitBy(pos) ?? "");
                }

                if (signals)
                {
                    row.Add(CsvText((pos.SignalTypeOpen ?? "").Trim(), sep));
                    row.Add(CsvText((pos.SignalTypeClose ?? "").Trim(), sep));
                }

                csv.Append(string.Join(sep, row)).Append("\r\n");
            }

            return WithBom(csv.ToString());
        }

        private byte[] BuildStatsCsv(Dictionary<string, object> stats)
        {
            string sep = _csvSeparator.ValueString == "," ? "," : ";";
            Dictionary<string, object> all = (Dictionary<string, object>)stats["all"];
            Dictionary<string, object> longs = (Dictionary<string, object>)stats["long"];
            Dictionary<string, object> shorts = (Dictionary<string, object>)stats["short"];

            StringBuilder csv = new StringBuilder();
            csv.Append(string.Join(sep, "metric", "all", "long", "short")).Append("\r\n");

            foreach (string key in all.Keys)
            {
                csv.Append(string.Join(sep,
                    key,
                    CsvValue(all[key], sep),
                    CsvValue(longs.ContainsKey(key) ? longs[key] : "", sep),
                    CsvValue(shorts.ContainsKey(key) ? shorts[key] : "", sep))).Append("\r\n");
            }

            return WithBom(csv.ToString());
        }

        private byte[] BuildRss(string slug, string publicName, List<Position> closed)
        {
            bool money = _showMoney.ValueBool;
            int count = Math.Max(1, _lastDealsCount.ValueInt);
            List<Position> last = closed.OrderByDescending(p => p.TimeClose).Take(count).ToList();

            StringBuilder rss = new StringBuilder();
            rss.Append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
            rss.Append("<rss version=\"2.0\">\n<channel>\n");
            rss.Append("<title>").Append(Xml(publicName)).Append(" — сделки</title>\n");
            rss.Append("<link>https://github.com/si0683/robotstatistics</link>\n");
            rss.Append("<description>Закрытые сделки робота ").Append(Xml(publicName)).Append(" (OsEngine)</description>\n");
            rss.Append("<lastBuildDate>").Append(DateTimeOffset.Now.ToString("r", CultureInfo.InvariantCulture)).Append("</lastBuildDate>\n");

            for (int i = 0; i < last.Count; i++)
            {
                Position pos = last[i];
                string direction = pos.Direction == Side.Buy ? "Long" : "Short";
                string percent = (pos.ProfitOperationPercent >= 0 ? "+" : "") + Math.Round(pos.ProfitOperationPercent, 2).ToString("0.##", CultureInfo.InvariantCulture) + " %";
                string title = pos.SecurityName + " " + direction + " " + percent;

                if (money)
                {
                    title += " (" + (pos.ProfitPortfolioAbs >= 0 ? "+" : "") + Math.Round(pos.ProfitPortfolioAbs, 2).ToString("0.##", CultureInfo.InvariantCulture) + ")";
                }

                string description = "Вход " + FormatTime(pos.TimeOpen) + ", цена " + pos.EntryPrice.ToString(CultureInfo.InvariantCulture)
                    + ". Выход " + FormatTime(pos.TimeClose) + ", цена " + pos.ClosePrice.ToString(CultureInfo.InvariantCulture) + ".";

                if (_showStops.ValueBool)
                {
                    if (pos.StopOrderPrice > 0)
                    {
                        description += " Стоп " + pos.StopOrderPrice.ToString(CultureInfo.InvariantCulture) + ".";
                    }

                    if (pos.ProfitOrderPrice > 0)
                    {
                        description += " Тейк " + pos.ProfitOrderPrice.ToString(CultureInfo.InvariantCulture) + ".";
                    }

                    string exitBy = GetExitBy(pos);

                    if (exitBy != null)
                    {
                        description += exitBy == "stop" ? " Закрыта по стопу." : " Закрыта по тейку.";
                        title += exitBy == "stop" ? " · стоп" : " · тейк";
                    }
                }

                DateTimeOffset closeTime = new DateTimeOffset(DateTime.SpecifyKind(pos.TimeClose, DateTimeKind.Unspecified),
                    TimeZoneInfo.Local.GetUtcOffset(pos.TimeClose));

                rss.Append("<item>\n");
                rss.Append("<title>").Append(Xml(title)).Append("</title>\n");
                rss.Append("<description>").Append(Xml(description)).Append("</description>\n");
                rss.Append("<guid isPermaLink=\"false\">").Append(Xml(slug + "-" + pos.Number)).Append("</guid>\n");
                rss.Append("<pubDate>").Append(closeTime.ToString("r", CultureInfo.InvariantCulture)).Append("</pubDate>\n");
                rss.Append("</item>\n");
            }

            rss.Append("</channel>\n</rss>\n");

            return Encoding.UTF8.GetBytes(rss.ToString());
        }

        private static string FormatTime(DateTime time)
        {
            if (time == DateTime.MinValue)
            {
                return null;
            }

            return time.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        }

        private static string CsvNumber(decimal value, string sep)
        {
            string text = value.ToString(CultureInfo.InvariantCulture);
            return sep == ";" ? text.Replace('.', ',') : text;
        }

        private static string CsvValue(object value, string sep)
        {
            if (value is decimal number)
            {
                return CsvNumber(number, sep);
            }

            if (value is int integer)
            {
                return integer.ToString(CultureInfo.InvariantCulture);
            }

            return CsvText(value?.ToString() ?? "", sep);
        }

        private static string CsvText(string text, string sep)
        {
            if (text.Contains(sep) || text.Contains("\"") || text.Contains("\n"))
            {
                return "\"" + text.Replace("\"", "\"\"") + "\"";
            }

            return text;
        }

        private static byte[] WithBom(string text)
        {
            byte[] bom = Encoding.UTF8.GetPreamble();
            byte[] body = Encoding.UTF8.GetBytes(text);
            byte[] result = new byte[bom.Length + body.Length];
            Buffer.BlockCopy(bom, 0, result, 0, bom.Length);
            Buffer.BlockCopy(body, 0, result, bom.Length, body.Length);
            return result;
        }

        private static string Xml(string text)
        {
            return System.Security.SecurityElement.Escape(text ?? "");
        }

        private static string MakeSlug(string name)
        {
            const string ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
            string[] en = { "a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "h", "c", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya" };

            StringBuilder slug = new StringBuilder();
            string lower = (name ?? "").ToLowerInvariant();

            for (int i = 0; i < lower.Length; i++)
            {
                char c = lower[i];
                int ruIndex = ru.IndexOf(c);

                if (ruIndex >= 0)
                {
                    slug.Append(en[ruIndex]);
                }
                else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
                {
                    slug.Append(c);
                }
                else if (slug.Length > 0 && slug[slug.Length - 1] != '-')
                {
                    slug.Append('-');
                }
            }

            string result = slug.ToString().Trim('-');
            return result == "" ? "robot" : result;
        }

        #endregion

        #region HTTP

        private Dictionary<string, byte[]> _cache = new Dictionary<string, byte[]>();

        private readonly object _cacheLocker = new object();

        private readonly object _listenerLocker = new object();

        private HttpListener _listener;

        // Настройки, с которыми последний раз запускали (или пытались запустить) HTTP.
        // Пока они не меняются, повторных попыток нет — ошибка не сыпется в лог каждую секунду.
        private string _appliedHttpSettings = "";

        private void EnsureListener()
        {
            int port = _httpPort.ValueInt;
            bool allAddresses = _httpAllAddresses.ValueBool;
            string settings = port + "|" + allAddresses;

            lock (_listenerLocker)
            {
                if (_appliedHttpSettings == settings)
                {
                    return;
                }
            }

            StopListener();

            lock (_listenerLocker)
            {
                _appliedHttpSettings = settings;
            }

            if (port <= 0)
            {
                return;
            }

            HttpListener listener = new HttpListener();
            listener.Prefixes.Add(allAddresses ? $"http://+:{port}/" : $"http://localhost:{port}/");

            try
            {
                listener.Start();
            }
            catch (Exception error)
            {
                try
                {
                    listener.Close();
                }
                catch
                {
                    // ignore
                }

                string hint = allAddresses
                    ? $" Для доступа с других компьютеров один раз выполните от администратора: netsh http add urlacl url=http://+:{port}/ user=Все (на английской Windows user=Everyone)."
                    : " Возможно, порт занят другой программой.";

                SendNewLogMessage("RobotStatistics: HTTP на порту " + port + " не запущен: " + error.Message + hint, LogMessageType.Error);
                return;
            }

            lock (_listenerLocker)
            {
                _listener = listener;
            }

            Task.Run(() => ListenLoop(listener));

            SendNewLogMessage("RobotStatistics: HTTP запущен: http://" + (allAddresses ? "<адрес-сервера>" : "localhost") + ":" + port + "/robots.json", LogMessageType.System);
        }

        private void StopListener()
        {
            HttpListener listener;

            lock (_listenerLocker)
            {
                listener = _listener;
                _listener = null;
                _appliedHttpSettings = "";
            }

            if (listener == null)
            {
                return;
            }

            try
            {
                listener.Stop();
                listener.Close();
            }
            catch
            {
                // ignore
            }
        }

        private async Task ListenLoop(HttpListener listener)
        {
            while (listener.IsListening)
            {
                HttpListenerContext context;

                try
                {
                    context = await listener.GetContextAsync();
                }
                catch
                {
                    return; // listener остановлен
                }

                try
                {
                    HandleRequest(context);
                }
                catch (Exception error)
                {
                    SendNewLogMessage("RobotStatistics HTTP: " + error.Message, LogMessageType.Error);

                    try
                    {
                        context.Response.Abort();
                    }
                    catch
                    {
                        // ignore
                    }
                }
            }
        }

        private void HandleRequest(HttpListenerContext context)
        {
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;

            response.Headers["Access-Control-Allow-Origin"] = "*";
            response.Headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
            response.Headers["X-Content-Type-Options"] = "nosniff";

            if (request.HttpMethod == "OPTIONS")
            {
                response.StatusCode = 204;
                response.Close();
                return;
            }

            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")
            {
                response.StatusCode = 405;
                response.Close();
                return;
            }

            string path = (request.Url?.AbsolutePath ?? "/").Trim('/');

            if (path == "")
            {
                path = StartProgram == StartProgram.IsTester ? "tester/runs.json" : "robots.json";
            }

            byte[] body = null;

            lock (_cacheLocker)
            {
                _cache.TryGetValue(path, out body);
            }

            if (body == null)
            {
                response.StatusCode = 404;
                WriteBody(response, request, Encoding.UTF8.GetBytes("{\"error\":\"not found\"}"), "application/json; charset=utf-8");
                return;
            }

            string etag = "\"" + Convert.ToHexString(SHA1.HashData(body)).Substring(0, 16) + "\"";
            response.Headers["ETag"] = etag;
            response.Headers["Cache-Control"] = "public, max-age=15";

            if (request.Headers["If-None-Match"] == etag)
            {
                response.StatusCode = 304;
                response.Close();
                return;
            }

            WriteBody(response, request, body, GetContentType(path));
        }

        private static void WriteBody(HttpListenerResponse response, HttpListenerRequest request, byte[] body, string contentType)
        {
            response.ContentType = contentType;
            response.ContentLength64 = body.Length;

            if (request.HttpMethod != "HEAD")
            {
                response.OutputStream.Write(body, 0, body.Length);
            }

            response.Close();
        }

        private static string GetContentType(string path)
        {
            if (path.EndsWith(".json"))
            {
                return "application/json; charset=utf-8";
            }

            if (path.EndsWith(".csv"))
            {
                return "text/csv; charset=utf-8";
            }

            if (path.EndsWith(".rss"))
            {
                return "application/rss+xml; charset=utf-8";
            }

            return "application/octet-stream";
        }

        #endregion
    }

    /// <summary>Строка выбора робота: публиковать или нет и как подписать на сайте.</summary>
    public class RobotStatisticsChoice
    {
        public string Name;

        public string Type;

        public bool Selected;

        public string PublicName;
    }

    /// <summary>Окно «Какие роботы публиковать»: список роботов терминала с галочками и подписями.
    /// Оформление — стили и цвета текущей темы OsEngine (WindowStyleCanResize, ControlForegroundWhite и т. д.),
    /// поэтому окно выглядит как остальные окна OsEngine и меняется вместе с темой.</summary>
    public class RobotStatisticsChooseUi : System.Windows.Window
    {
        public bool PublishAll;

        public List<RobotStatisticsChoice> Rows;

        private System.Windows.Controls.CheckBox _allBox;

        private List<System.Windows.Controls.CheckBox> _rowBoxes = new List<System.Windows.Controls.CheckBox>();

        private List<System.Windows.Controls.TextBox> _nameBoxes = new List<System.Windows.Controls.TextBox>();

        // выбор по отдельным роботам — сохраняем, пока включено «все роботы»
        private List<bool> _savedSelection = new List<bool>();

        private System.Windows.Controls.Grid _grid;

        private System.Windows.Controls.TextBlock _counter;

        public RobotStatisticsChooseUi(List<RobotStatisticsChoice> rows, bool publishAll)
        {
            Rows = rows;
            PublishAll = publishAll;

            Title = "RobotStatistics — какие роботы показывать на сайте";
            Width = 680;
            Height = 540;
            MinWidth = 520;
            MinHeight = 360;
            WindowStartupLocation = System.Windows.WindowStartupLocation.CenterScreen;
            ShowInTaskbar = false;

            ApplyOsEngineStyle();

            System.Windows.Controls.Grid root = new System.Windows.Controls.Grid();
            root.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = System.Windows.GridLength.Auto });
            root.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
            root.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = System.Windows.GridLength.Auto });

            // ---------- верх: пояснение и «все роботы» ----------
            System.Windows.Controls.Grid top = MakePanel();
            System.Windows.Controls.StackPanel topStack = new System.Windows.Controls.StackPanel();
            topStack.Margin = new System.Windows.Thickness(12, 10, 12, 10);

            System.Windows.Controls.TextBlock hint = MakeText(
                "Отметьте роботов, статистику которых нужно публиковать на сайте. " +
                "«Подпись на сайте» — как робот будет называться у посетителей; пусто — имя из OsEngine.", false);
            hint.TextWrapping = System.Windows.TextWrapping.Wrap;
            hint.Margin = new System.Windows.Thickness(0, 0, 0, 8);
            topStack.Children.Add(hint);

            _allBox = new System.Windows.Controls.CheckBox();
            _allBox.Content = MakeText("Публиковать всех роботов — новые роботы добавятся сами", true);
            _allBox.IsChecked = publishAll;
            _allBox.Click += AllBox_Click;
            topStack.Children.Add(_allBox);

            top.Children.Add(topStack);
            System.Windows.Controls.Grid.SetRow(top, 0);
            root.Children.Add(top);

            // ---------- список роботов ----------
            System.Windows.Controls.Grid listPanel = MakePanel();
            listPanel.Margin = new System.Windows.Thickness(5, 0, 5, 5);

            System.Windows.Controls.Grid listLayout = new System.Windows.Controls.Grid();
            listLayout.Margin = new System.Windows.Thickness(12, 8, 12, 8);
            listLayout.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = System.Windows.GridLength.Auto });
            listLayout.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });

            System.Windows.Controls.Grid header = MakeRowGrid();
            header.Margin = new System.Windows.Thickness(0, 0, 0, 4);
            AddCell(header, MakeLabel("Робот"), 0);
            AddCell(header, MakeLabel("Тип"), 1);
            AddCell(header, MakeLabel("Подпись на сайте"), 2);
            System.Windows.Controls.Grid.SetRow(header, 0);
            listLayout.Children.Add(header);

            _grid = new System.Windows.Controls.Grid();

            if (rows.Count == 0)
            {
                System.Windows.Controls.TextBlock empty = MakeText(
                    "В этом режиме пока нет других роботов. Добавьте робота и откройте окно снова.", false);
                empty.Margin = new System.Windows.Thickness(0, 10, 0, 0);
                empty.TextWrapping = System.Windows.TextWrapping.Wrap;
                _grid.Children.Add(empty);
            }

            for (int i = 0; i < rows.Count; i++)
            {
                _grid.RowDefinitions.Add(new System.Windows.Controls.RowDefinition { Height = System.Windows.GridLength.Auto });

                System.Windows.Controls.Grid row = MakeRowGrid();
                row.Margin = new System.Windows.Thickness(0, 2, 0, 2);

                System.Windows.Controls.CheckBox box = new System.Windows.Controls.CheckBox();
                // TextBlock, а не строка: иначе WPF принимает «_» в имени за горячую клавишу и прячет его
                box.Content = MakeText(rows[i].Name, true);
                box.IsChecked = rows[i].Selected;
                box.ToolTip = rows[i].Name;
                box.Click += RowBox_Click;
                _rowBoxes.Add(box);
                _savedSelection.Add(rows[i].Selected);
                AddCell(row, box, 0);

                System.Windows.Controls.TextBlock type = MakeText(rows[i].Type, false);
                type.VerticalAlignment = System.Windows.VerticalAlignment.Center;
                type.TextTrimming = System.Windows.TextTrimming.CharacterEllipsis;
                type.ToolTip = rows[i].Type;
                AddCell(row, type, 1);

                System.Windows.Controls.TextBox publicName = new System.Windows.Controls.TextBox();
                publicName.Text = rows[i].PublicName ?? "";
                publicName.Height = 24;
                publicName.VerticalContentAlignment = System.Windows.VerticalAlignment.Center;
                _nameBoxes.Add(publicName);
                AddCell(row, publicName, 2);

                System.Windows.Controls.Grid.SetRow(row, i);
                _grid.Children.Add(row);
            }

            System.Windows.Controls.ScrollViewer scroll = new System.Windows.Controls.ScrollViewer();
            scroll.VerticalScrollBarVisibility = System.Windows.Controls.ScrollBarVisibility.Auto;
            scroll.HorizontalScrollBarVisibility = System.Windows.Controls.ScrollBarVisibility.Disabled;
            scroll.Content = _grid;
            System.Windows.Controls.Grid.SetRow(scroll, 1);
            listLayout.Children.Add(scroll);

            listPanel.Children.Add(listLayout);
            System.Windows.Controls.Grid.SetRow(listPanel, 1);
            root.Children.Add(listPanel);

            // ---------- кнопки ----------
            System.Windows.Controls.Grid bottom = new System.Windows.Controls.Grid();
            bottom.Margin = new System.Windows.Thickness(5, 0, 5, 8);
            bottom.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = System.Windows.GridLength.Auto });
            bottom.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
            bottom.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = System.Windows.GridLength.Auto });

            System.Windows.Controls.StackPanel leftButtons = new System.Windows.Controls.StackPanel();
            leftButtons.Orientation = System.Windows.Controls.Orientation.Horizontal;
            leftButtons.Children.Add(MakeButton("Отметить всех", SelectAll_Click, false));
            leftButtons.Children.Add(MakeButton("Снять все", SelectNone_Click, false));
            System.Windows.Controls.Grid.SetColumn(leftButtons, 0);
            bottom.Children.Add(leftButtons);

            _counter = MakeText("", false);
            _counter.VerticalAlignment = System.Windows.VerticalAlignment.Center;
            _counter.TextTrimming = System.Windows.TextTrimming.CharacterEllipsis;
            _counter.Margin = new System.Windows.Thickness(12, 0, 12, 0);
            System.Windows.Controls.Grid.SetColumn(_counter, 1);
            bottom.Children.Add(_counter);

            System.Windows.Controls.StackPanel rightButtons = new System.Windows.Controls.StackPanel();
            rightButtons.Orientation = System.Windows.Controls.Orientation.Horizontal;
            rightButtons.Children.Add(MakeButton("Отмена", Cancel_Click, false));
            rightButtons.Children.Add(MakeButton("Сохранить", Save_Click, true));
            System.Windows.Controls.Grid.SetColumn(rightButtons, 2);
            bottom.Children.Add(rightButtons);

            System.Windows.Controls.Grid.SetRow(bottom, 2);
            root.Children.Add(bottom);

            Content = root;
            UpdateState();
        }

        // Стиль окна OsEngine (рамка, заголовок, фон) — если окно открыто внутри OsEngine
        private void ApplyOsEngineStyle()
        {
            try
            {
                System.Windows.Application app = System.Windows.Application.Current;

                if (app == null)
                {
                    return;
                }

                if (app.TryFindResource("WindowStyleCanResize") is System.Windows.Style style)
                {
                    Style = style;
                }

                try
                {
                    Icon = new System.Windows.Media.Imaging.BitmapImage(new Uri("pack://application:,,,/OsEngine;component/Images/OsLogo.ico"));
                }
                catch
                {
                    // без иконки
                }
            }
            catch
            {
                // окно останется в стандартном оформлении Windows
            }
        }

        // Панель с фоном как у панелей OsEngine (Rectangle со стилем темы)
        private static System.Windows.Controls.Grid MakePanel()
        {
            System.Windows.Controls.Grid panel = new System.Windows.Controls.Grid();
            panel.Margin = new System.Windows.Thickness(5);
            System.Windows.Shapes.Rectangle background = new System.Windows.Shapes.Rectangle();
            background.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, "ControlBackgroundNormalLight");
            background.RadiusX = 2;
            background.RadiusY = 2;
            panel.Children.Add(background);
            return panel;
        }

        private static System.Windows.Controls.Grid MakeRowGrid()
        {
            System.Windows.Controls.Grid row = new System.Windows.Controls.Grid();
            row.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new System.Windows.GridLength(1.2, System.Windows.GridUnitType.Star) });
            row.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
            row.ColumnDefinitions.Add(new System.Windows.Controls.ColumnDefinition { Width = new System.Windows.GridLength(1.3, System.Windows.GridUnitType.Star) });
            return row;
        }

        private static void AddCell(System.Windows.Controls.Grid row, System.Windows.FrameworkElement element, int column)
        {
            element.Margin = new System.Windows.Thickness(0, 0, column < 2 ? 12 : 0, 0);
            System.Windows.Controls.Grid.SetColumn(element, column);
            row.Children.Add(element);
        }

        // Текст цветом темы: основной (ControlForegroundWhite) или второстепенный (TextSecondaryBrush)
        private static System.Windows.Controls.TextBlock MakeText(string text, bool main)
        {
            System.Windows.Controls.TextBlock block = new System.Windows.Controls.TextBlock();
            block.Text = text ?? "";
            block.FontSize = 13;
            block.SetResourceReference(System.Windows.Controls.TextBlock.ForegroundProperty, main ? "ControlForegroundWhite" : "TextSecondaryBrush");
            return block;
        }

        private static System.Windows.Controls.Label MakeLabel(string text)
        {
            System.Windows.Controls.Label label = new System.Windows.Controls.Label();
            label.Content = text;
            label.Padding = new System.Windows.Thickness(0);
            label.FontWeight = System.Windows.FontWeights.SemiBold;
            return label;
        }

        private static System.Windows.Controls.Button MakeButton(string text, System.Windows.RoutedEventHandler click, bool main)
        {
            System.Windows.Controls.Button button = new System.Windows.Controls.Button();
            button.Content = text;
            button.MinWidth = 120;
            button.Height = 26;
            button.Margin = new System.Windows.Thickness(0, 0, 6, 0);

            if (main)
            {
                button.FontWeight = System.Windows.FontWeights.Bold;
                button.Margin = new System.Windows.Thickness(0);
            }

            button.Click += click;
            return button;
        }

        private void UpdateState()
        {
            bool all = _allBox.IsChecked == true;
            int selected = 0;

            for (int i = 0; i < _rowBoxes.Count; i++)
            {
                _rowBoxes[i].IsEnabled = !all;
                _rowBoxes[i].IsChecked = all || _savedSelection[i];

                if (_savedSelection[i])
                {
                    selected++;
                }
            }

            _counter.Text = all
                ? "Выбраны все: " + _rowBoxes.Count
                : "Выбрано: " + selected + " из " + _rowBoxes.Count;
        }

        private void AllBox_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            UpdateState();
        }

        private void RowBox_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            int index = _rowBoxes.IndexOf((System.Windows.Controls.CheckBox)sender);

            if (index >= 0)
            {
                _savedSelection[index] = _rowBoxes[index].IsChecked == true;
            }

            UpdateState();
        }

        private void SelectAll_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            _allBox.IsChecked = false;

            for (int i = 0; i < _savedSelection.Count; i++)
            {
                _savedSelection[i] = true;
            }

            UpdateState();
        }

        private void SelectNone_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            _allBox.IsChecked = false;

            for (int i = 0; i < _savedSelection.Count; i++)
            {
                _savedSelection[i] = false;
            }

            UpdateState();
        }

        private void Save_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            PublishAll = _allBox.IsChecked == true;

            for (int i = 0; i < Rows.Count; i++)
            {
                Rows[i].Selected = _savedSelection[i];
                Rows[i].PublicName = _nameBoxes[i].Text.Trim();
            }

            DialogResult = true;
        }

        private void Cancel_Click(object sender, System.Windows.RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}
