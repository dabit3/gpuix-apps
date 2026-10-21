# Writes src/data/map.json: the district layout as ASCII rows (one char per tile).
import json
W, H = 40, 32
g = [['.'] * W for _ in range(H)]
def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = c
def put(pts, c):
    for x, y in pts:
        g[y][x] = c
blocks = [(0,0,11,9),(15,0,25,9),(29,0,39,9),(0,13,11,20),(15,13,25,20),(29,13,39,20),(0,24,11,31),(15,24,25,31),(29,24,39,31)]
for x0,y0,x1,y1 in blocks:
    rect(x0,y0,x1,y1,',')
for x in range(W):
    for y in (11, 22):
        if g[y][x] == '.': g[y][x] = '='
for y in range(H):
    for x in (13, 27):
        if g[y][x] in '.=': g[y][x] = '=' if g[y][x] == '.' else '+'
# A: Bleecker Row
rect(1,1,10,4,'#'); rect(1,5,4,8,'#'); rect(5,5,7,8,'r'); rect(8,5,10,8,'d')
put([(4,1),(10,4),(1,8),(7,4)],'r')
# B: St. Brigid
rect(16,1,21,5,'C'); put([(18,1)],'K'); rect(22,1,24,5,'g'); rect(16,6,24,8,'g')
put([(17,7),(19,8),(21,7),(23,8),(16,8)],'m'); put([(24,3),(23,1)],'T')
# C: the overpass
rect(29,0,39,2,'d'); rect(30,0,32,1,'#'); rect(29,3,39,4,'O'); rect(33,3,34,4,'r'); put([(35,2),(32,2)],'r')
rect(29,5,39,8,'d'); put([(31,6),(36,7)],'b'); rect(29,9,39,9,'f'); put([(33,9),(34,9)],'d')
# D: bodega
rect(2,14,6,16,'B'); rect(7,14,10,17,'#'); put([(10,17)],'r'); put([(1,19),(2,19)],'c')
# E: Bleecker St Station
rect(16,15,24,19,'_'); put([(16,14),(17,14)],'U'); rect(18,14,24,14,'w'); put([(20,14)],'_')
rect(16,15,16,19,'w'); put([(19,16),(22,16),(19,18),(22,18)],'p')
# F: radio shack
rect(30,14,35,16,'#'); rect(36,14,38,16,'R'); put([(38,14)],'A'); rect(30,18,33,19,'r'); put([(35,19),(36,19)],'c'); put([(33,17)],'b')
# G: Washington Sq + Shelter 34
rect(0,24,11,31,'g'); put([(2,25),(9,25),(1,30),(10,30)],'T'); rect(4,26,6,27,'H'); rect(5,28,5,31,',')
# H: rad field
rect(15,24,25,31,'r'); rect(18,26,22,29,'~'); put([(17,27),(23,26),(21,30)],'~'); put([(16,26),(24,29)],'b'); put([(25,31),(15,31)],'c')
# I: ruined lots
rect(33,25,38,28,'#'); put([(35,25),(38,28),(33,28)],'r'); rect(29,29,39,31,'r'); put([(30,26),(31,26)],'c')
# street clutter
put([(13,16),(14,17),(26,5),(20,11),(21,11),(27,19),(12,27)],'c'); put([(12,23),(26,12)],'b')
rows = [''.join(r) for r in g]
legend = {
  '.': 'asphalt', '=': 'lane', '+': 'crossing', ',': 'sidewalk', 'd': 'dirt', 'g': 'grass', 'r': 'rubble',
  '~': 'radpool', '_': 'platform', '#': 'brownstone', 'B': 'bodega', 'C': 'church', 'K': 'steeple',
  'U': 'kiosk', 'w': 'lowwall', 'p': 'pillar', 'O': 'overpass', 'f': 'fence', 'b': 'barrel', 'c': 'car',
  'T': 'tree', 'm': 'tombstone', 'H': 'hatch', 'R': 'shack', 'A': 'mast'
}
regions = [
  {"name": "Bleecker Row", "x0": 0, "y0": 0, "x1": 11, "y1": 9},
  {"name": "St. Brigid's", "x0": 15, "y0": 0, "x1": 25, "y1": 9},
  {"name": "The Overpass", "x0": 29, "y0": 0, "x1": 39, "y1": 9},
  {"name": "Quintero Bodega", "x0": 0, "y0": 13, "x1": 11, "y1": 20},
  {"name": "Bleecker St Station", "x0": 15, "y0": 13, "x1": 25, "y1": 20},
  {"name": "WKNY Radio", "x0": 29, "y0": 13, "x1": 39, "y1": 20},
  {"name": "Washington Sq", "x0": 0, "y0": 24, "x1": 11, "y1": 31},
  {"name": "Con Ed Crater", "x0": 15, "y0": 24, "x1": 25, "y1": 31},
  {"name": "Houston Lots", "x0": 29, "y0": 24, "x1": 39, "y1": 31}
]
json.dump({"width": W, "height": H, "rows": rows, "legend": legend, "regions": regions}, open('src/data/map.json', 'w'), indent=1)
print('\n'.join(rows))
