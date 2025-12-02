import pyvirtualcam
import numpy as np
from windows_capture import WindowsCapture, Frame, InternalCaptureControl
from threading import Lock
import time
import cv2

# Глобальные переменные для хранения кадра
current_frame = None
frame_lock = Lock()

def on_frame_arrived(frame: Frame, capture_control: InternalCaptureControl):
    global current_frame
    with frame_lock:
        # Конвертируем в numpy array
        current_frame = frame.convert_to_bgr().frame_buffer.copy()

def on_closed():
    print("Захват закрыт")

def main():
    global current_frame
    
    WIDTH = 1280
    HEIGHT = 720
    FPS = 24
    
    print("Запускаю захват окна Particle Studio...")
    
    # Создаём захват по названию окна
    capture = WindowsCapture(
        cursor_capture=False,
        draw_border=False,
        window_name="Particle Studio"
    )
    
    capture.event(on_frame_arrived)
    capture.event(on_closed)
    
    # Запускаем захват в отдельном потоке
    capture.start_free_threaded()
    
    print(f"Запускаю виртуальную камеру {WIDTH}x{HEIGHT} @ {FPS}fps")
    print("В Zoom/Discord выбери 'OBS Virtual Camera'")
    print("Ctrl+C для остановки")
    
    time.sleep(1)  # Даём время на инициализацию
    
    with pyvirtualcam.Camera(width=WIDTH, height=HEIGHT, fps=FPS) as cam:  # автовыбор бэкенда
        print(f"Камера: {cam.device}")
        
        black_frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        
        while True:
            try:
                with frame_lock:
                    frame = current_frame
                
                if frame is not None:
                    # BGR -> RGB
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    # Ресайз
                    frame = cv2.resize(frame, (WIDTH, HEIGHT))
                    cam.send(frame)
                else:
                    cam.send(black_frame)
                
                cam.sleep_until_next_frame()
                
            except KeyboardInterrupt:
                print("\nОстановлено")
                break
            except Exception as e:
                print(f"Ошибка: {e}")
                cam.send(black_frame)
                cam.sleep_until_next_frame()

if __name__ == "__main__":
    main()
