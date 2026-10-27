#!/usr/bin/env python3
"""Yaya: real triangle meshes, orthographic software rasterization, no numpy.
Run: python3 scripts/render-yaya-3d.py [--state working|done|snack|walk|sleep|idle]
Only Pillow + stdlib required. Model units: Y up, Z forward. No Blender used.
"""
import argparse, json, math, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/pet-yaya-3d'
W,H,AA,N,S = 256,288,2,16,64
# Reference D / 2D body: soft periwinkle; keep shadows violet, never saturated blue.
BLUE=(150,137,226); MINT=(117,227,181); CREAM=(255,242,212)
STATES=('working','done','snack','walk','sleep','idle','tantrum','proud','swing')
CY,SY=math.cos(.28),math.sin(.28)
CP,SP=math.cos(.14),math.sin(.14)
LIGHT=(-.45,.70,.65)

def norm(v):
    d=math.sqrt(sum(a*a for a in v)) or 1
    return tuple(a/d for a in v)
LIGHT=norm(LIGHT)
def project(p):
    x,y,z=p; dep=SY*x+CY*z
    return ((128+S*(CY*x-SY*z))*AA,(247-S*(CP*y-SP*dep))*AA,SP*y+CP*dep)
def rotate(p,a):
    x,y,z=p; c,s=math.cos(a),math.sin(a)
    return (c*x-s*y,s*x+c*y,z)
def rotate_y(p,a):
    x,y,z=p; c,s=math.cos(a),math.sin(a)
    return (c*x+s*z,y,-s*x+c*z)
def screen_point(x,y,depth=0):
    # Inverse orthographic camera: screen right, screen up, camera forward.
    u=(x-128)/S; v=(247-y)/S
    return (CY*u-SY*SP*v+SY*CP*depth, CP*v+SP*depth, -SY*u-CY*SP*v+CY*CP*depth)
def signedpow(a,p): return math.copysign(abs(a)**p,a)

class Scene:
    def __init__(self,state='idle',phase=0):
        self.parts=[]; self.state=state; self.phase=phase
        self.bob=.025*math.sin(phase)+.008*math.cos(2*phase+.4)
    def root(self,p,normal=False):
        if self.state=='sleep':
            if normal: return rotate(p,-1.30)
            q=rotate((p[0],p[1]-1.40,p[2]),-1.30)
            return (q[0]-.12,q[1]+.78,q[2])
        if self.state=='tantrum':
            # Roll around the MODEL Y/body long axis, then lay that axis on
            # the ground. The same rigid rotations apply to every normal.
            angle=1.85*math.sin(self.phase)
            q=rotate_y(p if normal else (p[0],p[1]-1.40,p[2]),angle)
            q=rotate(q,-math.pi/2)
            if normal:return q
            return (.66*q[0],.66*q[1],.66*q[2]+.30*math.sin(self.phase))
        if self.state=='swing':
            # Parallel equal-length ropes: seat follows an exact pendulum arc.
            angle=.22*math.sin(self.phase); length=4.3-.23
            if normal:return p
            return (.72*(p[0]+length*math.sin(angle)),3.50+.72*(p[1]-4.3+length*(1-math.cos(angle))),.72*p[2])
        if normal:return p
        return (p[0],p[1]+self.bob,p[2])
    def ell(self,name,center,radius,color,angle=0,segments=24,rings=14,power=1,root=True):
        vs=[]; ns=[]; faces=[]
        for j in range(rings+1):
            lat=-math.pi/2+math.pi*j/rings
            for i in range(segments+1):
                lon=2*math.pi*i/segments
                u=(math.cos(lat)*math.cos(lon),math.sin(lat),math.cos(lat)*math.sin(lon))
                local=tuple(radius[k]*signedpow(u[k],power) for k in range(3))
                n=norm(tuple(signedpow(u[k],2-power)/radius[k] for k in range(3)))
                v=tuple(a+b for a,b in zip(rotate(local,angle),center)); n=rotate(n,angle)
                vs.append(self.root(v) if root else v); ns.append(self.root(n,True) if root else n)
        for j in range(rings):
            for i in range(segments):
                a=j*(segments+1)+i; b=a+segments+1
                if j>0: faces.append((a,b,a+1))
                if j<rings-1: faces.append((a+1,b,b+1))
        self.parts.append((name,vs,ns,faces,color,None,None))
    def rod(self,name,a,b,r,color,root=True):
        # Capsules made from a cylinder aligned to an arbitrary 3D segment.
        axis=norm(tuple(b[i]-a[i] for i in range(3)))
        ref=(0,0,1) if abs(axis[2])<.9 else (0,1,0)
        cross=lambda u,v:(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
        u=norm(cross(axis,ref)); v=cross(axis,u); vs=[]; ns=[]; fs=[]
        for end in (a,b):
            for i in range(12):
                t=i*math.tau/12; n=tuple(u[k]*math.cos(t)+v[k]*math.sin(t) for k in range(3))
                p=tuple(end[k]+r*n[k] for k in range(3))
                vs.append(self.root(p) if root else p); ns.append(self.root(n,True) if root else n)
        for i in range(12):
            q=(i+1)%12; fs.extend(((i,q,i+12),(q,q+12,i+12)))
        self.parts.append((name,vs,ns,fs,color,None,None))
        for i,p in enumerate((a,b)):self.ell(name+'_cap'+str(i),p,(r,r,r),color,segments=10,rings=6,root=root)
    def leaf(self,name,base,tip,width):
        dx,dy=tip[0]-base[0],tip[1]-base[1]; length=math.hypot(dx,dy)
        color=((235,72,36) if name=='leaf_left' else (247,91,40)) if self.state=='working' else MINT
        self.ell(name,((base[0]+tip[0])/2,(base[1]+tip[1])/2,base[2]),(width,length/2,.105),color,-math.atan2(dx,dy),segments=24,rings=16,power=1.18)
        a=(base[0],base[1],base[2]+.10); b=(tip[0]*.90+base[0]*.1,tip[1]*.90+base[1]*.1,base[2]+.11)
        self.rod(name+'_midrib',a,b,.018,(255,164,77) if self.state=='working' else (179,250,203))
    def logo(self,texture):
        vs=[]; ns=[]; uv=[]; faces=[]; nx,ny=16,4
        for j in range(ny+1):
            for i in range(nx+1):
                x=(i/nx-.5)*.86; y=1.0+(0.5-j/ny)*.22
                z=.602+.125*math.sqrt(max(0,1-(x/.57)**2-((y-1.01)/.43)**2))
                vs.append(self.root((x,y,z+.008))); ns.append(self.root((0,0,1),True)); uv.append((i/nx,j/ny))
        for j in range(ny):
            for i in range(nx):
                a=j*(nx+1)+i;b=a+nx+1;faces.extend(((a,a+1,b),(a+1,b+1,b)))
        self.parts.append(('DoCode_curved_decal',vs,ns,faces,(255,255,255),uv,texture))

def logo_texture():
    im=Image.new('RGBA',(240,64)); d=ImageDraw.Draw(im); f=ImageFont.truetype('DejaVuSans-Bold.ttf',45)
    box=d.textbbox((0,0),'DoCode',font=f); d.text(((240-(box[2]-box[0]))/2,-box[1]+8),'DoCode',font=f,fill=(71,58,126,255))
    return im
LOGO=logo_texture()

def build(state,t):
    sc=Scene(state,t); ell=sc.ell; rod=sc.rod
    breathing=1+.015*math.sin(t)+.004*math.cos(2*t+.4)
    body=BLUE
    ell('bean_body',(0,1.43,0),(.94,1.13*breathing,.64),body,segments=40,rings=26)
    ell('cream_belly',(0,1.01,.602),(.57,.43,.125),CREAM,segments=30,rings=18)
    sc.logo(LOGO)
    blink=.07 if (state=='sleep' or (t>math.tau*6/16 and t<math.tau*8/16)) else 1
    for side in (-1,1):
        x=side*.34
        ell('eye_white_'+str(side),(x,1.88,.581),(.265,.315,.17),(255,253,241),segments=24,rings=16)
        if state in ('done','tantrum') or (state=='swing' and math.sin(t)>.15) or blink<.1:
            arch=.085 if state in ('done','swing') else (-.06 if state=='tantrum' else -.025)
            for j in range(6):
                u=-1+j/3; v=-1+(j+1)/3
                rod('expression_lid_'+str(side),(x+.155*u,1.87+arch*(1-u*u),.759),(x+.155*v,1.87+arch*(1-v*v),.759),.022,(54,39,110))
            if state=='tantrum':
                fall=.18+.21*(.5+.5*math.sin(t+side))
                ell('tear_'+str(side),(x,1.74-fall,.746),(.067,.15,.036),(160,220,245))
        else:
            proud=state=='proud'; gaze=.060 if proud else .025
            ell('pupil_'+str(side),(x+gaze,1.90 if proud else 1.87,.735),(.135,.105 if proud else .195,.057),(43,32,78),segments=22,rings=14)
            ell('eye_glint_'+str(side),(x+gaze-.035,1.958,.783),(.045,.040 if proud else .061,.018),(255,255,255),segments=14,rings=10)
            if proud:rod('proud_brow_'+str(side),(x-.15,2.055,.755),(x+.15,2.015,.755),.028,BLUE)
        ell('cheek_'+str(side),(side*.64,1.51,.474),(.155,.075,.046),(249,157,186),angle=-side*.12)
    if state in ('snack','tantrum'):
        opening=.065+.05*(.5+.5*math.sin(t)) if state=='snack' else .15
        ell('open_mouth',(0,1.47,.675),(.12,opening,.032),(65,39,91))
        ell('tongue',(0,1.43-opening*.3,.706),(.07,.035,.010),(242,152,177))
    else:
        for a,b in [((-.105,1.49,.667),(0,1.448,.680)),((0,1.448,.680),(.105,1.49,.667))]: rod('smile',a,b,.022,(58,36,105))
    sway=.07*math.sin(t)
    rod('sprout_stem',(0,2.44,0),(.03,2.80,0),.046,(180,48,24) if state=='working' else (92,185,144))
    sc.leaf('leaf_left',(.0,2.64,.01),(-.76+sway,3.30,.01),.245)
    sc.leaf('leaf_right',(.02,2.70,.025),(.53+sway,3.09,.025),.185)
    for side in (-1,1):
        stride=.25*math.sin(t+side*math.pi/2) if state=='walk' else 0
        foot=(side*.44,(.238-sc.bob if state=='walk' else .28)+max(0,stride),.15+stride*1.6)
        if state=='snack':
            # Snack pose keeps a visible calf rooted in the body and the sole on turf.
            foot=(side*.58,.20,.20)
        elif state=='tantrum':foot=(side*(.5+.14*math.sin(t+side)),.22+.22*math.cos(t+side),.38)
        elif state=='swing':foot=(side*.44,.42,.48)
        if state=='tantrum':rod('kicking_leg_'+str(side),(side*.40,.55,.12),foot,.145,BLUE)
        if state=='snack':
            ell('foot_'+str(side),foot,(.24,.21,.33),BLUE,angle=-side*.15,root=False)
            # Solve contact against the actual tessellated grass/foot surfaces,
            # not a nominal ellipsoid radius; breathing must not lift the feet.
            name,vs,ns,fs,color,uv,tex=sc.parts[-1]
            sole=min(vs,key=lambda v:v[1]); sx,_,sz=sole
            grass_y=.10+.08*math.sqrt(max(0,1-(sx/1.43)**2-(sz/.85)**2))
            lift=grass_y-sole[1]-.008
            sc.parts[-1]=(name,[(x,y+lift,z) for x,y,z in vs],ns,fs,color,uv,tex)
            foot=(foot[0],foot[1]+lift,foot[2])
            rod('snack_leg_'+str(side),sc.root((side*.40,.64,.10)),foot,.185,BLUE,root=False)
        else:
            ell('foot_'+str(side),foot,(.24,.21,.33),BLUE,angle=-side*.15)
        shoulder=(side*.78,1.36,.00)
        hand=(side*1.0,.94,.17)
        if state=='working':hand=(side*.57,.96+side*.16*math.sin(4*t),1.10)  # fingertips contact .75-high keys on each downstroke
        elif state=='done': hand=screen_point(128+side*88,190,1.34)  # chest-height world-space grip below
        elif state=='walk':hand=(side*.90,1.05,.34+stride*.35)
        elif state=='snack':hand=(side*.88,1.03+.22*math.sin(t) if side==1 else .65,.60)
        elif state=='tantrum':hand=(side*(.92+.12*math.sin(t+side)),1.65+.32*math.cos(t+side),.22)
        elif state=='proud':hand=(side*.42,1.30,.38)
        elif state=='swing':hand=(side*.75,1.90,.45)
        elif state=='sleep':hand=(side*.70,1.1,.43)
        if state=='done':
            shoulder=sc.root((side*.81,1.36,.12))
            elbow=screen_point(128+side*60,193,.68)
            hand=screen_point(128+side*83,193,1.34)
            rod('holding_upper_arm_'+str(side),shoulder,elbow,.15,BLUE,root=False)
            rod('holding_forearm_'+str(side),elbow,hand,.14,BLUE,root=False)
            ell('gripping_hand_'+str(side),hand,(.16,.18,.15),BLUE,root=False)
            rod('gripping_thumb_'+str(side),screen_point(128+side*77,194,1.49),screen_point(128+side*76,187,1.49),.060,BLUE,root=False)
            for finger in range(2):
                x=128+side*(83+finger*4)
                rod('gripping_finger_%s_%s'%(side,finger),screen_point(x,198,1.47),screen_point(x,190,1.47),.038,BLUE,root=False)
        elif state!='proud':
            rod('arm_'+str(side),shoulder,hand,.14,BLUE)
            ell('hand_'+str(side),hand,(.19,.20,.18),BLUE)
    if state=='working':
        ell('grass_patch',(0,-.025,.25),(1.70,.07,1.38),(131,200,140),segments=32,rings=12,root=False)
        for i in range(13):
            x=-1.5+i*.25; z=-.58+.07*(i%3)
            rod('grass_blade',(x,.02,z),(x+.04,.16+.04*(i%2),z),.020,(100,177,117),root=False)
        ell('mint_keyboard',(.0,.62,1.10),(1.18,.10,.49),(102,211,176),power=.25,root=False)
        for row in range(3):
            for col in range(8):
                ell('key_%s_%s'%(row,col),((col-3.5)*.26,.75, .82+row*.26),(.104,.035,.087),(209,255,222),power=.35,segments=8,rings=6,root=False)
        # A side monitor behind the right hand, kept within the 256px frame.
        ell('computer_base',(1.39,.15,-.10),(.32,.06,.31),(99,111,139),power=.3,root=False)
        rod('computer_stand',(1.39,.18,-.10),(1.39,.83,-.10),.055,(115,132,159),root=False)
        ell('computer_case',(1.39,1.13,-.12),(.36,.43,.09),(94,111,145),power=.2,root=False)
        ell('computer_screen',(1.39,1.15,-.02),(.30,.34,.022),(151,221,233),power=.2,root=False)
        for row in range(3):
            rod('computer_text_'+str(row),(1.20,1.31-row*.13,.008),(1.48+(row%2)*.09,1.31-row*.13,.008),.015,(231,255,246),root=False)
        for i in range(8):
            side=-1 if i<4 else 1; lane=i%4
            fall=(t/math.tau+lane*.23+(0 if side<0 else .11))%1
            x=side*(.94+.115*lane); y=2.40-.88*fall
            ell('sweat_'+str(i),(x,y,.36+.025*lane),(.048,.085+.035*fall,.035),(131,226,255),angle=-side*.24,segments=14,rings=10)
            ell('sweat_tip_'+str(i),(x-side*.012,y+.076,.36+.025*lane),(.025,.049,.026),(161,237,255),angle=-side*.24,segments=10,rings=8)
        for i in range(3):
            rise=(t/math.tau+i/3)%1
            for j in range(3):
                ell('steam_%s_%s'%(i,j),(-.78+i*.73+.055*math.sin(t*2+j),2.65+.54*rise+j*.065,.10),(.038+.022*rise,.065,.028),(220,228,244),segments=10,rings=8)
    elif state=='done':
        # Projected chest board: 170 x 50, below the smile and above the feet.
        # Short arms wrap both side edges; front grips stay outside safeRect.
        def outline(inset,depth):
            left,top,right,bottom=43+inset,170+inset,213-inset,220-inset
            r=10-inset; points=[]
            for cx,cy,start in ((right-r,top+r,-90),(right-r,bottom-r,0),(left+r,bottom-r,90),(left+r,top+r,180)):
                for step in range(9):
                    angle=math.radians(start+step*90/8)
                    points.append(screen_point(cx+r*math.cos(angle),cy+r*math.sin(angle),depth))
            return points
        n=(SY*CP,SP,CY*CP)
        rings=[outline(0,1.04),outline(0,1.13),outline(1.2,1.18),outline(2.2,1.20),outline(3,1.21)]
        for layer,color in enumerate(((192,165,195),(215,199,232),(230,201,157),(255,240,215))):
            outer,inner=rings[layer:layer+2]; count=len(outer)
            vs=outer+inner; faces=[]
            for i in range(count):
                j=(i+1)%count; faces.extend(((i,j,count+j),(i,count+j,count+i)))
            sc.parts.append(('sign_edge_'+str(layer),vs,[n]*len(vs),faces,color,None,None))
        face=rings[-1]; count=len(face)
        vs=[screen_point(128,195,1.21)]+face
        sc.parts.append(('blank_sign',vs,[n]*len(vs),[(0,i+1,(i+1)%count+1) for i in range(count)],(255,246,225),None,None))
        back=rings[0]; vs=[screen_point(128,195,1.04)]+back
        sc.parts.append(('sign_edge_back',vs,[tuple(-v for v in n)]*len(vs),[(0,(i+1)%count+1,i+1) for i in range(count)],(192,165,195),None,None))
    elif state=='proud':
        for side in (-1,1):
            elbow=(side*.76,1.45,.51); hand=(-side*.30,1.58+side*.06,.82)
            rod('folded_upper_'+str(side),(side*.78,1.36,.12),elbow,.15,BLUE)
            rod('folded_forearm_'+str(side),elbow,hand,.145,BLUE)
            ell('folded_hand_'+str(side),hand,(.18,.15,.13),BLUE)
    elif state=='swing':
        ell('swing_seat',(0,.20,.16),(1.02,.095,.55),(193,143,102),power=.25)
        for side in (-1,1):
            rod('swing_rope_'+str(side),sc.root((side*.86,.23,.43)),(side*.72*.86,3.50,.72*.43),.021,(225,211,179),root=False)
            ell('swing_anchor_'+str(side),(side*.72*.86,3.50,.72*.43),(.08,.08,.08),(112,107,138),root=False)
        rod('swing_crossbar',(-.82,3.50,.31),(.82,3.50,.31),.050,(112,107,138),root=False)
    elif state=='snack':
        ell('grass_patch',(0,.10,0),(1.43,.08,.85),(131,200,140),segments=32,rings=12,root=False)
        for i in range(11):
            x=-1.2+i*.24; z=-.38+.13*(i%3)
            rod('grass_blade',(x,.15,z),(x+.04,.30+.06*(i%2),z),.020,(100,177,117),root=False)
        k=.5+.5*math.sin(t); a=(.93-.53*k,.88+.51*k,.90); b=(.57-.47*k,1.49+.06*k,.85)
        rod('skewer',a,b,.026,(177,116,64))
        for j in range(3):
            u=.35+j*.22;p=tuple(a[i]*(1-u)+b[i]*u for i in range(3))
            ell('roasted_bite_'+str(j),p,(.13,.12,.12),(205+12*j,122+10*j,64),angle=.4,power=.55,segments=14,rings=10)
    elif state=='walk':
        # Turf surface sits just below the supporting sole; blades stay behind feet.
        ell('grass_patch',(0,-.025,0),(1.43,.05,.85),(131,200,140),power=.35,segments=32,rings=12,root=False)
        for i in range(11):
            x=-1.2+i*.24; z=-.58+.06*(i%3)
            rod('grass_blade',(x,.015,z),(x+.04,.13+.04*(i%2),z),.020,(100,177,117),root=False)
    elif state=='sleep':
        ell('nose_bubble',(.17,1.57,.84),(.19+.04*math.sin(t),.22+.04*math.sin(t),.16),(177,219,249),segments=24,rings=16)
        ell('bubble_glint',(.10,1.65,.98),(.040,.060,.016),(243,253,255))
    if state=='tantrum':
        # Ground contact solved from ALL transformed mesh vertices, including
        # waving limbs and sprout; translation does not alter the normals.
        lowest=min(v[1] for part in sc.parts for v in part[1])
        lift=.06-lowest
        sc.parts=[(name,[(x,y+lift,z) for x,y,z in vs],ns,fs,color,uv,tex)
                  for name,vs,ns,fs,color,uv,tex in sc.parts]
    return sc

def render(scene):
    ww,hh=W*AA,H*AA
    image=Image.new('RGBA',(ww,hh)); shadow=Image.new('RGBA',(ww,hh)); sd=ImageDraw.Draw(shadow)
    if scene.state=='tantrum':
        # Project the actual ground beneath the laid-down mesh; a standing
        # character's fixed shadow makes the sideways pose appear to hover.
        verts=[v for p in scene.parts for v in p[1]]
        cx=(min(v[0] for v in verts)+max(v[0] for v in verts))/2
        cz=(min(v[2] for v in verts)+max(v[2] for v in verts))/2
        sx,sy,_=project((cx,0,cz))
        sd.ellipse((sx-91*AA,sy-10*AA,sx+91*AA,sy+8*AA),fill=(40,33,87,57))
    else:
        sd.ellipse((46*AA,235*AA,210*AA,260*AA),fill=(40,33,87,43))
    shadow=shadow.filter(ImageFilter.GaussianBlur(6*AA)); image.alpha_composite(shadow)
    pix=image.load(); depth=[-1e9]*(ww*hh)
    for name,verts,normals,faces,color,uv,texture in scene.parts:
        ps=[project(v) for v in verts]
        shades=[.67+.33*max(0,sum(n[k]*LIGHT[k] for k in range(3))) for n in normals]
        tex=texture.load() if texture else None
        for ids in faces:
            ia,ib,ic=ids; a,b,c=ps[ia],ps[ib],ps[ic]
            den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            xmin=max(0,int(min(a[0],b[0],c[0])));xmax=min(ww-1,math.ceil(max(a[0],b[0],c[0])))
            ymin=max(0,int(min(a[1],b[1],c[1])));ymax=min(hh-1,math.ceil(max(a[1],b[1],c[1])))
            ax=(b[1]-c[1])/den;ay=(c[0]-b[0])/den;bx=(c[1]-a[1])/den;by=(a[0]-c[0])/den
            for y in range(ymin,ymax+1):
                wa=ax*(xmin+.5-c[0])+ay*(y+.5-c[1]);wb=bx*(xmin+.5-c[0])+by*(y+.5-c[1]); offset=y*ww
                for x in range(xmin,xmax+1):
                    wc=1-wa-wb
                    if wa>=-1e-6 and wb>=-1e-6 and wc>=-1e-6:
                        z=wa*a[2]+wb*b[2]+wc*c[2]; idx=offset+x
                        if z>depth[idx]:
                            if tex:
                                u=wa*uv[ia][0]+wb*uv[ib][0]+wc*uv[ic][0];v=wa*uv[ia][1]+wb*uv[ib][1]+wc*uv[ic][1]
                                rgba=tex[min(texture.width-1,max(0,int(u*texture.width))),min(texture.height-1,max(0,int(v*texture.height)))]
                                if rgba[3]>128: pix[x,y]=rgba;depth[idx]=z
                            else:
                                light=wa*shades[ia]+wb*shades[ib]+wc*shades[ic]
                                pix[x,y]=tuple(min(255,int(ch*light)) for ch in color)+(255,);depth[idx]=z
                    wa+=ax;wb+=bx
    return image.resize((W,H),getattr(Image,'Resampling',Image).LANCZOS)

def export_obj(scene):
    folder=OUT/'source';folder.mkdir(parents=True,exist_ok=True)
    materials={}; lines=['# Yaya true triangle mesh; Y up, Z forward; generated by scripts/render-yaya-3d.py','mtllib neutral.mtl']; offset=1
    for name,vs,ns,fs,color,uv,texture in scene.parts:
        if texture:continue
        mat='rgb_'+'_'.join(map(str,color));materials[mat]=color
        lines.extend(['o '+name,'usemtl '+mat])
        lines.extend('v %.6f %.6f %.6f'%v for v in vs)
        lines.extend('vn %.6f %.6f %.6f'%n for n in ns)
        lines.extend('f '+' '.join('%d//%d'%(offset+i,offset+i) for i in f) for f in fs)
        offset+=len(vs)
    (folder/'neutral.obj').write_text('\n'.join(lines)+'\n')
    (folder/'neutral.mtl').write_text('\n'.join('newmtl %s\nKd %.5f %.5f %.5f\nKa .2 .2 .2\nKs 0 0 0\nNs 1\n'%(name,*(v/255 for v in color)) for name,color in materials.items()))
    return offset-1,sum(len(p[3]) for p in scene.parts if not p[6])

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--state',choices=STATES);args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    # A --state pass touches only its atlas, never neutral source or manifest.
    vertices,triangles=export_obj(build('idle',0)) if not args.state else (0,0)
    def xy(p): return [round(v/AA,2) for v in project(p)[:2]]
    manifest={'width':W,'height':H,'fps':12,'columns':4,'rows':4,'alpha':True,'renderer':'Python/Pillow triangle rasterizer; 2x SSAA; orthographic depth buffer; smooth normal lighting','model':{'file':'source/neutral.obj','materials':'source/neutral.mtl','vertices':vertices,'triangles':triangles,'upAxis':'Y','frontAxis':'Z'},'states':{state:{'file':state+'.png','frames':N,'columns':4,'rows':4,'loop':True} for state in STATES},'aliases':{'work':'working','asking':'idle'},'overlays':{'coordinateSpace':'single sprite logical pixels, origin top-left; scale together with sprite','done':{'polygon':[[43,170],[213,170],[213,220],[43,220]],'center':[128,195],'boardSize':{'width':170,'height':50},'safeRect':{'x':60,'y':178,'width':136,'height':32},'lineHeight':16,'font':'bold 14px sans-serif','color':'#594374','text':'runtime token text; board intentionally blank'},'sleep':{'zzzAnchor':[194,115],'dreamAnchor':[128,61],'text':'runtime zzz and coin dream; not baked'}},'source':'../../../scripts/render-yaya-3d.py'}
    if not args.state:
        (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    for state in ([args.state] if args.state else STATES):
        start=time.monotonic();sheet=Image.new('RGBA',(W*4,H*4))
        for i in range(N):
            frame=render(build(state,i*math.tau/N));sheet.paste(frame,((i%4)*W,(i//4)*H))
            print(state,i+1,'/',N,flush=True)
        sheet.save(OUT/(state+'.png'),optimize=True)
        print('SAVED',state,sheet.size,'seconds',round(time.monotonic()-start,2),flush=True)
    print('COMPLETE',vertices,'vertices',triangles,'triangles',flush=True)
if __name__=='__main__':main()
