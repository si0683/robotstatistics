<?php
/*
 * RobotStatistics — приёмник данных от OsEngine одним PHP-файлом.
 * https://github.com/si0683/robotstatistics
 *
 * Подходит для любого PHP-хостинга и CMS: WordPress, 1С-Битрикс, MODX, Joomla, OpenCart, самописный сайт.
 * PHP 7.4+, без библиотек и базы данных.
 *
 * КАК ПОДКЛЮЧИТЬ
 *   1. Создайте на сайте папку robot-stats (рядом с index.php сайта) и положите туда этот файл.
 *   2. Впишите ключ ниже (или задайте переменную окружения ROBOT_STATS_KEY).
 *   3. В OsEngine у RobotStatistics, вкладка «Куда»:
 *        «Отправлять на адрес (webhook)» = https://ваш-сайт.ru/robot-stats/robot-stats.php
 *        «Ключ для webhook»              = тот же ключ
 *   4. Через 30 секунд в папке появятся robots.json, папки роботов и т. д.
 *      Виджет:  data-src="/robot-stats/robots.json"
 *
 * Проверка: откройте https://ваш-сайт.ru/robot-stats/robot-stats.php в браузере — увидите состояние приёмника.
 */

// ===== НАСТРОЙКА =====
$ROBOT_STATS_KEY = getenv('ROBOT_STATS_KEY') ?: 'ЗАМЕНИТЕ-НА-СВОЙ-ДЛИННЫЙ-КЛЮЧ';
$DATA_DIR = __DIR__;                 // куда складывать данные (по умолчанию — эта же папка)
$MAX_BODY = 50 * 1024 * 1024;        // 50 МБ (если больше post_max_size в php.ini — поднимите его)
// =====================

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function rs_json($status, $data)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Ключ из заголовка Authorization: Bearer … — хостинги прячут его по-разному; запасной вариант — ?key=… в адресе
function rs_given_key()
{
    $candidates = array(
        isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '',
        isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) ? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] : '',
    );
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower($name) === 'authorization') {
                $candidates[] = $value;
            }
        }
    }
    foreach ($candidates as $value) {
        if ($value !== '') {
            return trim(preg_replace('/^Bearer\s+/i', '', $value));
        }
    }
    return isset($_GET['key']) ? (string)$_GET['key'] : '';
}

// Только «нормальные» пути: латиница, цифры, - _ . /, расширения json/csv/rss, без «..»
function rs_safe_relative($rel)
{
    if (!is_string($rel) || !preg_match('#^[A-Za-z0-9_\-./]+$#', $rel)) {
        return null;
    }
    $parts = array();
    foreach (explode('/', $rel) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            return null;
        }
        $parts[] = $part;
    }
    $norm = implode('/', $parts);
    return preg_match('/\.(json|csv|rss)$/', $norm) ? $norm : null;
}

function rs_write($path, $content)
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        return false;
    }
    $tmp = $path . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $content, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $path)) {           // Windows: rename не перезаписывает существующий файл
        @unlink($path);
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            return false;
        }
    }
    return true;
}

function rs_remove_dir($dir)
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        is_dir($path) ? rs_remove_dir($path) : @unlink($path);
    }
    @rmdir($dir);
}

// Apache: разрешить виджету на другом домене читать файлы и передать заголовок Authorization в PHP
function rs_ensure_htaccess($dir)
{
    $file = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (file_exists($file)) {
        return;
    }
    @file_put_contents($file,
        "# RobotStatistics\n" .
        "<IfModule mod_headers.c>\n" .
        "  <FilesMatch \"\\.(json|csv|rss)$\">\n" .
        "    Header set Access-Control-Allow-Origin \"*\"\n" .
        "    Header set Cache-Control \"public, max-age=10\"\n" .
        "  </FilesMatch>\n" .
        "</IfModule>\n" .
        "AddType application/rss+xml .rss\n" .
        "AddType text/csv .csv\n" .
        "SetEnvIf Authorization \"(.*)\" HTTP_AUTHORIZATION=$1\n");
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    http_response_code(204);
    exit;
}

$keyConfigured = $ROBOT_STATS_KEY !== '' && $ROBOT_STATS_KEY !== 'ЗАМЕНИТЕ-НА-СВОЙ-ДЛИННЫЙ-КЛЮЧ';

// GET — проверка в браузере: что настроено и когда последний раз приходили данные
if ($method === 'GET') {
    $robots = $DATA_DIR . DIRECTORY_SEPARATOR . 'robots.json';
    $runs = $DATA_DIR . DIRECTORY_SEPARATOR . 'tester' . DIRECTORY_SEPARATOR . 'runs.json';
    rs_json(200, array(
        'receiver' => 'RobotStatistics PHP',
        'key_configured' => $keyConfigured,
        'writable' => is_writable($DATA_DIR),
        'terminal_data' => file_exists($robots) ? date('c', filemtime($robots)) : null,
        'tester_data' => file_exists($runs) ? date('c', filemtime($runs)) : null,
    ));
}

if ($method !== 'POST') {
    rs_json(405, array('error' => 'method not allowed'));
}

if (!$keyConfigured) {
    rs_json(500, array('error' => 'задайте ключ в robot-stats.php ($ROBOT_STATS_KEY)'));
}

if (!hash_equals($ROBOT_STATS_KEY, rs_given_key())) {
    rs_json(401, array('error' => 'wrong key'));
}

$length = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
if ($length > $MAX_BODY) {
    rs_json(413, array('error' => 'too large'));
}

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload) || !isset($payload['files']) || !is_array($payload['files'])) {
    rs_json(400, array('error' => 'bad json'));
}

if (!is_dir($DATA_DIR) && !mkdir($DATA_DIR, 0775, true)) {
    rs_json(500, array('error' => 'cannot create data dir'));
}
rs_ensure_htaccess($DATA_DIR);

$written = 0;
foreach ($payload['files'] as $rel => $text) {
    $safe = rs_safe_relative($rel);
    if ($safe === null || !is_string($text)) {
        continue;
    }
    // CSV — с BOM, чтобы Excel сразу понял кириллицу
    $content = substr($safe, -4) === '.csv' ? "\xEF\xBB\xBF" . $text : $text;
    if (rs_write($DATA_DIR . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $safe), $content)) {
        $written++;
    }
}

// прогоны тестера, которые OsEngine уже удалил у себя
$removed = 0;
if (isset($payload['removed_runs']) && is_array($payload['removed_runs'])) {
    foreach ($payload['removed_runs'] as $id) {
        if (is_string($id) && preg_match('/^[0-9_-]+$/', $id)) {
            $dir = $DATA_DIR . DIRECTORY_SEPARATOR . 'tester' . DIRECTORY_SEPARATOR . 'runs' . DIRECTORY_SEPARATOR . $id;
            if (is_dir($dir)) {
                rs_remove_dir($dir);
                $removed++;
            }
        }
    }
}

rs_json(200, array('ok' => true, 'written' => $written, 'removed' => $removed));
