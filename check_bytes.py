with open('main.js', 'rb') as f:
    lines = f.readlines()
    
line = lines[1255]
print("Line 1256 bytes:", line)
print("Line 1256 string:", line.decode('utf-8'))
