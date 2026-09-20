import sys
import os
import cv2
import numpy as np
import ddddocr

def solve(image_path):
    if not os.path.exists(image_path):
        return ""
    img = cv2.imread(image_path)
    if img is None:
        return ""
    
    # 1. Convert to HSV to isolate bright blue digits
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_blue = np.array([80, 60, 80])
    upper_blue = np.array([140, 255, 255])
    mask = cv2.inRange(hsv, lower_blue, upper_blue)
    
    # 2. Invert mask so digits are black on pure white background
    inverted = cv2.bitwise_not(mask)
    
    # 3. Add white border for optimal OCR recognition
    bordered = cv2.copyMakeBorder(inverted, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
    
    # 4. OCR with ddddocr
    ocr = ddddocr.DdddOcr(show_ad=False)
    _, buf = cv2.imencode('.png', bordered)
    res = ocr.classification(buf.tobytes())
    digits = ''.join([c for c in res if c.isdigit()])
    return digits

if __name__ == '__main__':
    if len(sys.argv) > 1:
        result = solve(sys.argv[1])
        print("RESULT:" + result)
    else:
        print("RESULT:")
