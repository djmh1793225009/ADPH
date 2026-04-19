import os
import json
import requests
import time
import concurrent.futures
import re
import threading

from rich.console import Console
from rich.live import Live
from rich.table import Table

# ================= 配置参数 =================

PROMPT_TEMPLATE = (
    "按照下述提示词和反向提示词生成图像。仅输出图片，禁止输出文字内容。并满足下面要求："
    "提示词：{positive}。反向提示词：{negative}"
)
# ---- 输入图片 URL（最多三张，注释掉不需要的行）----
IMAGE_URLS = [
    "https://img.cdn1.vip/i/69dcb1048d036_1776070916.webp",  # 图片1
    #"https://img.cdn1.vip/i/69db4ea69cbf4_1775980198.webp"  # 图片2（按需取消注释）
    # "https://example.com/image3.jpg",                      # 图片3（按需取消注释）
]

BASE_URL     = "https://api.apipass.dev"
MODEL_NAME   = "google/nano-banana-2"

CREATE_URL   = f"{BASE_URL}/api/v1/jobs/createTask"
QUERY_URL    = f"{BASE_URL}/api/v1/jobs/recordInfo"

JSON_FILE    = "./tmp.json"
OUTPUT_DIR   = "./image"
RETRY_FILE   = "./re.json"

POLL_INTERVAL   = 8    # 每次轮询间隔
POLL_TIMEOUT    = 600  # 最长超时时间
MAX_POLL_LIMIT  = 9    # 增加的轮询上限

# ================ 控制台 UI ================
console = Console()
tasks_info = {}
state_lock = threading.Lock()
file_lock = threading.Lock()

_key_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "c:\\Users\\Administrator\\Desktop", "key.json")
with open(_key_path, "r", encoding="utf-8") as _kf:
    _keys = json.load(_kf)
API_KEY = _keys["GeminiOnly_api_key"]

def set_task_state(idx, name=None, status=None, result=None):
    with state_lock:
        if idx not in tasks_info:
            tasks_info[idx] = {"name": name or "-", "status": status or "-", "result": result or "-"}
        else:
            if name is not None:
                tasks_info[idx]["name"] = str(name)
            if status is not None:
                tasks_info[idx]["status"] = str(status)
            if result is not None:
                tasks_info[idx]["result"] = str(result)

def pop_task_state(idx):
    with state_lock:
        return tasks_info.pop(idx, None)

def generate_table():
    table = Table(show_header=True, header_style="bold magenta", width=console.width)
    table.add_column("名字", style="cyan", width=30, overflow="fold")
    table.add_column("状态", style="yellow", width=25)
    table.add_column("结果", style="green")

    with state_lock:
        for idx in sorted(tasks_info.keys()):
            info = tasks_info[idx]
            table.add_row(info["name"], info["status"], info["result"])
    return table

# ================ 工具函数 ================

def append_to_retry_file(item):
    """将失败的条目追加到 re.json"""
    with file_lock:
        retry_data = []
        if os.path.exists(RETRY_FILE):
            try:
                with open(RETRY_FILE, 'r', encoding='utf-8') as f:
                    retry_data = json.load(f)
            except (json.JSONDecodeError, IOError):
                retry_data = []
        retry_data.append(item)
        with open(RETRY_FILE, 'w', encoding='utf-8') as f:
            json.dump(retry_data, f, ensure_ascii=False, indent=4)

def create_task(prompt, image_url):
    """向 apipass 提交图生图任务，返回 taskId"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL_NAME,
        "input": {
            "prompt": prompt,
        #    "image_input": image_url,
            "aspect_ratio": "4:3",
            "resolution": "1K",
            "google_search": False,
            "image_search": False,
            "output_format": "png"
        },
    }
    resp = requests.post(CREATE_URL, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 200:
        raise RuntimeError(f"创建任务失败: {data}")
    return data["data"]["taskId"]

def poll_task(task_id, idx):
    """
    轮询任务状态，直到 state == 'success' 或 'fail'。
    成功后返回生成图片 URL 列表，失败或超时抛出异常。
    """
    headers = {"Authorization": f"Bearer {API_KEY}"}
    elapsed = 0

    state_cn_map = {
        "waiting": "等待处理",
        "queuing": "队列中",
        "generating": "生成中",
        "success": "完成",
        "fail": "失败"
    }

    while elapsed < POLL_TIMEOUT:
        try:
            resp = requests.get(
                QUERY_URL,
                params={"taskId": task_id},
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            set_task_state(idx, status=f"轮询中 ({elapsed}s)", result=f"请求出错: {str(e)[:10]}")
            time.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL
            continue

        if data.get("code") != 200:
            raise RuntimeError(f"查询状态问题: {data}")

        state = data["data"].get("state", "")
        state_text = f"{state}{state_cn_map.get(state, '')}"
        
        set_task_state(idx, status=f"轮询中 ({elapsed}s)", result=state_text)

        if state == "success":
            result_raw = data["data"].get("resultJson", {})
            result_obj = result_raw if isinstance(result_raw, dict) else json.loads(result_raw)
            result_urls = result_obj.get("resultUrls", [])

            filtered_urls = [url for url in result_urls if re.match(r"https://cdn\.apipass\.dev/.*", url)]
            return filtered_urls

        elif state == "fail":
            raise RuntimeError(f"平台内部失败: {data['data']}")

        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    raise RuntimeError(f"任务超时 (>{POLL_TIMEOUT}s)")

def get_unique_filename(directory, base_name, extension):
    """生成唯一的文件名，避免重名覆盖"""
    counter = 0
    while True:
        suffix = f"_{counter}" if counter > 0 else ""
        unique_name = f"{base_name}{suffix}.{extension}"
        unique_path = os.path.join(directory, unique_name)
        if not os.path.exists(unique_path):
            return unique_path
        counter += 1

def download_image(url, save_path):
    """从 URL 下载图片并保存到本地"""
    response = requests.get(url, stream=True, timeout=60)
    if response.status_code == 200:
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(1024):
                f.write(chunk)
        return True
    return False

def poll_and_download(task_id, item, style_name_en, idx):
    """
    运行在辅助线程中的任务处理流程：
    轮询 -> 获取URL -> 下载图片 -> 如果环节失败，写入 re.json
    """
    try:
        set_task_state(idx, status="等待查询...")
        result_urls = poll_task(task_id, idx)
        
        if not result_urls:
            raise RuntimeError("返回的 URL 列表为空")

        saved_files = []
        for i, img_url in enumerate(result_urls):
            suffix = f"_{i}" if len(result_urls) > 1 else ""
            base_name = f"{style_name_en}{suffix}"
            save_path = get_unique_filename(OUTPUT_DIR, base_name, "png")

            set_task_state(idx, status=f"下载 ({i+1}/{len(result_urls)})")
            if download_image(img_url, save_path):
                saved_files.append(save_path)
            else:
                raise RuntimeError(f"图片下载失败 {img_url}")

        set_task_state(idx, status="已完成", result="下载成功")
        time.sleep(1) # 视觉缓冲停留
        pop_task_state(idx)
        console.print(f"[bold green][√] {style_name_en} 成功: {', '.join(saved_files)}[/bold green]")

    except Exception as e:
        err_msg = str(e)
        set_task_state(idx, status="后台失败", result=err_msg[:30])
        time.sleep(2)
        pop_task_state(idx)
        console.print(f"[bold red][✗] {style_name_en} 任务失败: {err_msg}[/bold red]")
        append_to_retry_file(item)


def main():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        console.print(f"[green][*] 已创建输出目录: {OUTPUT_DIR}[/green]")

    if not os.path.exists(JSON_FILE):
        console.print(f"[red][!] 错误: 找不到文件 {JSON_FILE}[/red]")
        return

    console.print(f"[green][*] 使用图片 URL: {IMAGE_URLS}[/green]")

    with open(JSON_FILE, 'r', encoding='utf-8') as f:
        try:
            data_list = json.load(f)
        except json.JSONDecodeError:
            console.print(f"[red][!] 错误: {JSON_FILE} 不是有效的 JSON 格式[/red]")
            return

    console.print(f"[green][*] 成功加载 {len(data_list)} 条数据，开始执行并发生成任务...[/green]\n")

    # 并发控制和线程池 (主线程控制队列分发速度)
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_POLL_LIMIT + 5)
    active_futures = set()

    with Live(get_renderable=generate_table, refresh_per_second=2, console=console) as live:
        for index, item in enumerate(data_list):
            style_name_en = item.get("风格名称（英）", f"output_{index}").strip()
            positive      = item.get("正向提示词", "").strip()
            negative      = item.get("反向提示词", "").strip()

            set_task_state(index, name=style_name_en, status="分发队列验证", result="-")

            # => 限制同时进行轮询的任务数 <= 9
            while len(active_futures) >= MAX_POLL_LIMIT:
                set_task_state(index, status=f"等待可用槽位 (限制最大并发={MAX_POLL_LIMIT})", result=f"积压排队 ({len(active_futures)})")
                done, not_done = concurrent.futures.wait(
                    active_futures, return_when=concurrent.futures.FIRST_COMPLETED
                )
                active_futures = not_done

            # 过滤提示词中的 {prompt} 关键词
            positive = positive.replace("{prompt}", "").strip()
            negative = negative.replace("{prompt}", "").strip()

            prompt_text = PROMPT_TEMPLATE.format(positive=positive, negative=negative)

            attempt = 0
            max_normal_retries = 2
            waited_for_poll = False
            task_id = None

            while True:
                try:
                    set_task_state(index, status="提交数据...", result=f"尝试第 {attempt + 1} 次")
                    task_id = create_task(prompt_text, IMAGE_URLS)
                    break
                except Exception as e:
                    attempt += 1
                    err_message = str(e)[:30]
                    
                    if attempt <= max_normal_retries:
                        set_task_state(index, status=f"POST失败", result=f"等待5s重试 ({attempt}/{max_normal_retries})")
                        time.sleep(5)
                    else:    
                        if not waited_for_poll:
                            set_task_state(index, status="常规重试耗尽", result="等待轮询释放做最后重试")
                            if active_futures:
                                done_futures, active_futures = concurrent.futures.wait(
                                    active_futures, return_when=concurrent.futures.FIRST_COMPLETED
                                )
                            waited_for_poll = True
                            continue
                        else:
                            set_task_state(index, status="彻底提交放弃", result=err_message)
                            break 
                            
            if task_id:
                set_task_state(index, status="已获任务ID", result=task_id[-6:])
                future = executor.submit(poll_and_download, task_id, item, style_name_en, index)
                active_futures.add(future)
            else:
                set_task_state(index, status="写入记录表")
                time.sleep(1)
                pop_task_state(index)
                console.print(f"[yellow][!] {style_name_en} 失败跳过，已写入异常记录表。[/yellow]")
                append_to_retry_file(item)

            if active_futures:
                done, not_done = concurrent.futures.wait(active_futures, timeout=0)
                active_futures = not_done


        if active_futures:
            console.print(f"\n[bold cyan][*] 所有的POST请求下发完成，当前仍有 {len(active_futures)} 个后台任务处理中...[/bold cyan]")
            concurrent.futures.wait(active_futures)

    executor.shutdown()
    console.print("[bold green][*] 队列全部任务圆满执行完毕！[/bold green]")


if __name__ == "__main__":
    main()