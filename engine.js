// The DPS site's calculation and display code (from script.js, without the data).
var factions = ["British", "OKW", "Ostheer", "Soviet", "USF"];
var coverlabels = ["Default", "Light", "Heavy", "Garrison", "Negative"];
var cover_table_keys = ["tp_defcover", "tp_light", "tp_heavy", "tp_garrison_cover", "tp_negative"];
var factionSelected;

var target_size = 1;
var target_armor = 1;
var currentcover = 0;

var currentDPSMoving = [];
var currentDPS = [];
var currentdisplay = -1;
var currentunit = -1;
var currentweapon = -1;

var previousunit = -1;
var previousweapon = -1;
var previousDPS = [];
var previoustcover = -1;

var data = [];
var label = [];
var squadinfo = [];
var entities = [];
var titles = [];
var elabel = [];



function ScatterArea(weapon, range)
{
	var yscatter = distanceScatter(weapon, range);
	var angletan = Math.tan(weapon.scatter.angle_scatter * (Math.PI / 180));
	var max = (range+yscatter)*angletan;
	var min = (range-yscatter)*angletan;
	return 2*yscatter*(max+min);
}

function CircleOnTrapezoid(weapon, range, radius, previous)
{
	var offset = weapon.scatter.distance_scatter_offset;
	var yscatter = distanceScatter(weapon, range);
	var angletan = Math.tan(weapon.scatter.angle_scatter * (Math.PI / 180));
	var x = range*angletan;
	var xmin = (range-yscatter)*angletan;
	var xmax = (range+yscatter)*angletan;
	var ymax = yscatter*(1+offset);
	var ymin = yscatter*(1-offset);
	var overflow = 0;
	var area = CircleA(radius);	
	//No matter where you scatter, you hit, so just return 100%
	if((Math.pow(xmax, 2) + Math.pow(ymax, 2)) <= Math.pow(radius,2))
		return 1-previous;
	//If aoe radius does not overlap with scatter trapezoid in any way, we're done
	if(ymin >= radius && ymax >= radius && x >= radius)
	{
	}
	else
	{
		//Removing these for now because there's only a handful of units for which they make any difference at this range and the math is overly complex for little difference
		//console.log("Scatter overlap, ", area, ScatterArea(weapon, range), previous);
		/*
		//Remove top circle segment
		if(ymax <= radius)
			overflow += circlesegment(radius, ymax);
		//If radius bigger than x scatter at center, remove bottom half and add trapezoid 
		if(x <= radius && ymin <= radius)
		{
			area =- CircleA(radius)/2;
			area += (x+xmin) * ymin;	
		}
		else
		{
		//Else continue with circle, remove bottom overflow
			if(ymin <= radius)
			{
				overflow += circlesegment(radius, ymin);
			}
		//If x smaller than radius, need to remove areas of the circle outside of scatter trapezoid on the sides
			if(xmin <= radius){
				overflow += 0;
				//TODO
			}		
		}
		*/
	}
	var result = (area-overflow)/ScatterArea(weapon, range)-previous;
	return result >= 0 ? result : 0;
}

function circlesegment(radius, y)
{
	var result = Math.pow(radius,2)/2 * (offangle(radius, y) - Math.sin(offangle(radius,y)));
	return result;
}

function offangle(radius, y)
{
	return 2*Math.acos(y/radius);
}

function distanceScatter(weapon, range)
{
	return weapon.scatter.distance_scatter_ratio * range < weapon.scatter.distance_scatter_max ? weapon.scatter.distance_scatter_ratio * range : weapon.scatter.distance_scatter_max;			
}

function CircleA(r){
	return Math.PI*Math.pow(r, 2);
}

function AOERadius(area_effect)
{
	var far = area_effect.area_info.radius;
	var mid = area_effect.distance.mid+(area_effect.distance.far-area_effect.distance.mid)/2;
	var near = area_effect.distance.near+(area_effect.distance.mid-area_effect.distance.near)/2;
	return [near, mid, far];
}

function Limithitpercent(hits, aoe)
{
	if(hits[0] >= 1)
		return hits[0]*aoe.damage.near;
	if(hits[0]+hits[1] >= 1)
		return hits[0]*aoe.damage.near+(1-hits[0])*aoe.damage.mid;
	if(hits[0] + hits[1] + hits[2] > 1)
		return hits[0]*aoe.damage.near+hits[1]*aoe.damage.mid+(1-hits[0]-hits[1])*aoe.damage.far;
	return hits[0]*aoe.damage.near+hits[1]*aoe.damage.mid+(hits[2])*aoe.damage.far; 	
}

function GenerateBallisticData(weapon, moving)
{
   var result = [];
   if(moving)
	   return;
   //penetration, reload, damage, aoe
   result[0] = Rangemodifier(Minmax(weapon.range), weapon.penetration, weapon.range);
   result[0] = (result[0] >= 525) ? 525 : result[0];
   result[1] = DPSTime(weapon, Minmax(weapon.range), moving) / numberofshots(weapon, 40, false);
   result[1] = (result[1] >= 20) ? 20 : result[1];
   result[2] = getDamage(weapon);
   var radi = AOERadius(weapon.area_effect);
   var hits = [];
   hits[0] = CircleOnTrapezoid(weapon, 40, radi[0], 0);
   hits[1] = CircleOnTrapezoid(weapon, 40, radi[1], hits[0]);
   hits[2] = CircleOnTrapezoid(weapon, 40, radi[2], hits[1]+hits[0]);
   result[3] = result[2] * Limithitpercent(hits, weapon.area_effect);
   return result;
}

function mergeBallisticChart(){
	var gdata = new google.visualization.DataTable();
	gdata.addColumn('string', 'Weapon');
	gdata.addColumn('number', 'Penetration');
	gdata.addColumn('number', 'Reload');
	gdata.addColumn('number', 'Damage');
	gdata.addColumn('number', 'AOE');
	gdata.addRow([label[currentunit][currentweapon].toString(),currentDPS[0],currentDPS[1],currentDPS[2],currentDPS[3]]);
	if(previousunit != -1 && previousDPS.length < 8){
		gdata.addRow([label[previousunit][previousweapon].toString(), previousDPS[0], previousDPS[1], previousDPS[2], previousDPS[3]]);
	}
	return gdata;
}


function mergeChartD(){
	var gdata = new google.visualization.DataTable();
	var name1 = label[currentunit][currentweapon];
	var name2 = label[previousunit][previousweapon];
	if(name1 == name2 && currentunit == previousunit)
	{
		if(previousweapon > currentweapon)
			name2 += " vetted";
		else
			name1 += " vetted";
			
	}
	gdata.addColumn('number', 'Range');
	gdata.addColumn('number', name1);	
	gdata.addColumn('number', name2);
	for(var i=0;i<currentDPS.length;i++){
		    gdata.addRow([i,currentDPS[i], previousDPS[i]]);
		}
	if(previousDPS.length > currentDPS.length)
	{
		for(var i=currentDPS.length;i<previousDPS.length;i++){
		    gdata.addRow([i,0, previousDPS[i]]);
		}
		
	}
	return gdata;
}

function mergeChart(){
	var gdata = new google.visualization.DataTable();
	gdata.addColumn('number', 'Range');
	gdata.addColumn('number', label[currentunit][currentweapon]);
	gdata.addColumn({type: 'boolean', role: 'certainty'});
	if(currentDPSMoving[0] != 0)
	{
		gdata.addColumn('number', "moving");
		gdata.addColumn({type:'boolean',role:'certainty'});
		for(var i=0;i<currentDPS.length;i++){
			gdata.addRow([i,currentDPS[i], true, currentDPSMoving[i], false]);
		}
	}
	else
	{
		for(var i=0;i<currentDPS.length;i++){
		gdata.addRow([i,currentDPS[i], true]);
		}
	}
	return gdata;
}

function changeweapon(weapon)
{
	previousunit = currentunit;
	previousweapon = currentweapon;
	previousDPS = currentDPS;
	currentunit = currentdisplay;
	currentweapon = weapon;
	currentDPS = fullRangeDPS(currentunit, currentweapon, false);
	currentDPSMoving = fullRangeDPS(currentunit, currentweapon, true);
	drawChart();
}

function determinetitle()
{
	var vs = " vs ";
	var dotdot = ": ";
	var title = squadinfo[currentunit][0].concat(dotdot, label[currentunit][currentweapon]);
	if(currentunit != previousunit && previousunit != -1 )
	{
		if(currentDPS.length < 8 && previousDPS.length > 8 || currentDPS.length > 8 && previousDPS.length < 8 )
		{
		}
		else
		{
			title += vs;
			title += squadinfo[previousunit][0].concat(dotdot, label[previousunit][previousweapon]);
		}
	}
	if(currentunit == previousunit && currentweapon != previousweapon && previousweapon != -1)
	{
		if(currentDPS.length < 8 && previousDPS.length > 8 || currentDPS.length > 8 && previousDPS.length < 8 )
		{
		}
		else
		{
		title += vs+label[previousunit][previousweapon];	
		}		
	}
	return title;
}

function drawBubbleChart() {
		if(data[currentunit][currentweapon].damage.min === 0)
		{
			return;
		}
        var gdata = mergeBallisticChart()
        var charttitle = determinetitle();
		var dwidth = document.getElementById('curve_chart').style.width;
        var options = {
		  title: charttitle,
		  width: dwidth, height: 400, 
		  vAxis: {title: 'Reload time', ticks: [0, 2, 4, 6, 8, 10, 12,14]},
		  hAxis: {title: 'Penetration', viewWindow: {min: 0,}, gridlines: { count: 10,}},
          colorAxis: {legend:{position:'none'}, minValue: 20, maxValue: 320, colors: ['green', 'yellow', 'red']},
		  sizeAxis: {minSize: 5, minValue: 1, maxSize: 35, maxValue: 150},
        };

        var chart = new google.visualization.BubbleChart(document.getElementById('curve_chart'));
        chart.draw(gdata, options);
      }

function drawChart() {
		if(data[currentunit][currentweapon].damage.min === 0)
			return;
		if(currentDPS.length < 8 || data[currentunit][currentweapon].area_effect.area_info.radius > 1.5)
		{
			drawBubbleChart();
		}
		else
		{	
			var dwidth = document.getElementById('curve_chart').style.width;
			var gdata;
			if(previousunit == -1 || (currentunit == previousunit && currentweapon == previousweapon) || previousDPS.length < 8)
			{
			gdata = mergeChart();
			}
			else
				gdata = mergeChartD();
			var charttitle = determinetitle();
			var options = {
              title: charttitle,
              width: dwidth, height: 400, 
			  legend: { position: 'top' }, 
			  hAxis: { title: 'Range', ticks: [5,10,15,20,25,30,35, 40, 45] }, 
			  vAxis: { title: 'DPS'},
			  chartArea: {width: '70%', left: '5%'},
			  };
			var chart = new google.visualization.LineChart(document.getElementById('curve_chart'));
			chart.draw(gdata, options);
		}
}

function displaymenu(faction){
    factionSelected = factions[faction];
	document.getElementById("unitbuttons").innerHTML = document.getElementById(factionSelected).innerHTML;
	document.getElementById("FactionButton").innerHTML = factions[faction];}
	
function displayunit(unit){
	if(data[unit][0] != null)
	{
		if(currentdisplay == unit) // Makes it so clicking the unit a second time displays default weapon
		{
			currentunit = unit;
			currentweapon = squadinfo[currentunit][1];
			currentDPS = fullRangeDPS(currentunit, currentweapon, false);
			previousDPS = currentDPS;
			previousunit = currentunit;
			previousweapon = currentweapon;
			currentDPSMoving = fullRangeDPS(currentunit, currentweapon, true);
			drawChart();
		} else if(currentweapon == -1) { //If no weapon selected then display default weapon
			currentunit = unit;
			currentweapon = squadinfo[currentunit][1];
			currentDPS = fullRangeDPS(currentunit, currentweapon, false);
			currentDPSMoving = fullRangeDPS(currentunit, currentweapon, true);
			drawChart();
		}
	}
	currentdisplay = unit;
    PrintSquad(unit);
}

function changecover(cover){
	previouscover = currentcover;
	currentcover = cover;
	currentDPS = fullRangeDPS(currentunit, currentweapon, false);
	currentDPSMoving = fullRangeDPS(currentunit, currentweapon, true);
	if(previousweapon != -1 && previousunit != -1)
	{
		previousDPS = fullRangeDPS(previousunit, previousweapon, false);
	}
	drawChart();
}

function fullRangeDPS(unit, windex, moving, forcedps)
{
	var weapon = data[unit][windex];
	weapon.range = FillRangetable(weapon.range);	
	if(!forcedps && weapon.hasprojectile && (weapon.accuracy.near < 0.1 || weapon.accuracy.near > 10 || weapon.area_effect.area_info.radius > 2 || getDamage(weapon) >= 80))
	{
		return GenerateBallisticData(weapon, moving);
	}
	var DPS = [];
	var maxrange = weapon.range.max;
	for(var i=0;i<=maxrange;i++)
	{
		DPS[i] = DPSCalc(weapon, i, moving);
	}
	return DPS;
}

function Minmax(minmax){
   return (minmax.min+minmax.max)/2
}

function getDamage(weapon){
	return Minmax(weapon.damage)*weapon.cover_table[cover_table_keys[currentcover]].damage_multiplier;
}

function penetrate(pen){
	if(pen/target_armor <= 0.03)
		return 0;
	if(pen/target_armor >= 1)
		return 1;
	return pen/target_armor;
}

function DPSTime(weapon, range, moving)
{
	var time = 0;
	var bursttime = 0.125;
	if(weapon.burst.can_burst)
	{
		var burstdurationmod = Rangemodifier(range, weapon.burst.duration_multiplier, weapon.range); 
		if(moving)
			burstdurationmod *= weapon.moving.burst_multiplier;
		bursttime = 0.125* Math.ceil((Minmax(weapon.burst.duration)*burstdurationmod)/0.125);
	}
	var reloadfreq = Minmax(weapon.reload.frequency);
	var aimmodifier = Rangemodifier(range, weapon.aim.aim_time_multiplier, weapon.range); 
	var fireaim =  Minmax(weapon.aim.fire_aim_time) * aimmodifier;
	var readyaim = Minmax(weapon.aim.ready_aim_time) * aimmodifier;
	var cooldown = Minmax(weapon.cooldown.duration) * Rangemodifier(range, weapon.cooldown.duration_multiplier, weapon.range);
	var reloadduration = Minmax(weapon.reload.duration) * Rangemodifier(range, weapon.reload.duration_multiplier, weapon.range);
	if(moving)
		cooldown *= weapon.moving.cooldown_multiplier;
	time += bursttime+fireaim+cooldown+weapon.fire.wind_up+weapon.fire.wind_down;
	time *= reloadfreq;
	time += readyaim+reloadduration+bursttime+weapon.fire.wind_up+weapon.fire.wind_down;
	//Cooldown applied if only one shot per reload. Ignore ready aim for single fire weapons
	if(weapon.reload.frequency.max == 0)
	{
		time += cooldown;
		time -= readyaim;
		time += fireaim;
	}		
	return time;
}

function getAccuracy(weapon, range, moving,  noclip)
{
	var accumod = Rangemodifier(range, weapon.accuracy, weapon.range);
	var accuracy = accumod*weapon.cover_table[cover_table_keys[currentcover]].accuracy_multiplier;
	if(accuracy == 0 || (accuracy >= 3 && !noclip))
	   return 0;
	accuracy *= target_size;
	if(moving)
		accuracy *= weapon.moving.accuracy_multiplier;
	if(!noclip && accuracy > 1)
		accuracy = 1;
	return accuracy;
}

function burstduration(weapon, range, moving)
{
	var burst = 1;
	if(!weapon.burst.can_burst)
	{
		return burst;
	}
	var burstdurationmod = Rangemodifier(range, weapon.burst.duration_multiplier, weapon.range); 
	if(moving)
		burstdurationmod *= weapon.moving.burst_multiplier;
	var burstmin = weapon.burst.duration.min;
	var burstmax = weapon.burst.duration.max;
	if(burstmin == burstmax)
		{
			var burstbase = Minmax(weapon.burst.duration) * burstdurationmod * Minmax(weapon.burst.rate_of_fire) * Rangemodifier(range, weapon.burst.rate_of_fire_multiplier, weapon.range);
			burst = Math.floor(burstbase);
			if(burst == 0)
				burst = 1;
		}
	else
		{
			var burstresult = [];
			var count = 0;
			for(var i=burstmin;i<=burstmax;i=i+0.125)
			{
				burstresult[count] = Math.floor(i * burstdurationmod * Minmax(weapon.burst.rate_of_fire) * Rangemodifier(range, weapon.burst.rate_of_fire_multiplier, weapon.range));
				if(burstresult[count] == 0)
					burstresult[count] = 1;
				count++;
			}
			var sum = burstresult.reduce(function(a, b) { return a+b; });
			var avg = sum/burstresult.length;
			burst = avg;
		}
	return burst;			
}

function numberofshots(weapon, range, moving){
	var reloadfreq = Minmax(weapon.reload.frequency);
	return burstduration(weapon, range, moving) * (reloadfreq+1);
}

function DPSCalc(weapon, range, moving){
    if(moving && weapon.moving.disable_moving_firing)
	   return 0;
	var damage = 0;
	var accuracy = getAccuracy(weapon, range, moving)
	if(accuracy == 0)
	   return 0;
	damage = accuracy * getDamage(weapon) * numberofshots(weapon, range, moving);
	if(target_armor > 1)
	   damage *= penetrate(Rangemodifier(range, weapon.penetration, weapon.range));
	return (damage / DPSTime(weapon, range, moving));
}

function FillRangetable(ranges){
	if(ranges.distance.near == -1)
		ranges.distance.near = ranges.min;
	if(ranges.distance.far == -1)
		ranges.distance.far = ranges.max;
	if(ranges.distance.mid == -1)
		ranges.distance.mid= (ranges.distance.near+ranges.distance.far)/2;
	return ranges;
}

function Rangemodifier(range, multipliers, ranges){
	if(ranges.distance.near == -1 || ranges.distance.mid == -1 || ranges.distance.far == -1)
		ranges = FillRangetable(ranges);
	if(range > ranges.max || range < ranges.min)
		return 0;
	if(range <= ranges.distance.near)
		return multipliers.near;
	if(range == ranges.distance.mid && multipliers.mid != -1)
		return multipliers.mid;
	if(range >= ranges.distance.far)
		return multipliers.far;
	if(multipliers.near == multipliers.mid && multipliers.mid == multipliers.far)
		return multipliers.near;
	if(range > ranges.distance.mid)
	{
		var result = multipliers.mid - (multipliers.mid - multipliers.far ) * (range - ranges.distance.mid) / (ranges.distance.far - ranges.distance.mid);
		return result;	
	}
    var result = multipliers.near - (multipliers.near - multipliers.mid ) * (range - ranges.distance.near) / (ranges.distance.mid - ranges.distance.near);
    return result;	
}

function CreateAccordion(unitid, weaponid, wlink, wlabel)
{
if(unitid == -1 || weaponid == -1)
	return;
var container = document.createElement("SPAN");
var button = document.createElement("DIV");
button.className = "accordion";
button.onclick = function(){ accordfunction(button);};
button.appendChild(wlink);
var panel = document.createElement("DIV");
panel.className = "panel";
panel.id = unitid+weaponid;
container.appendChild(button);
statgenerator(panel, unitid, weaponid);
container.appendChild(panel);
return container;
}

function round(number, decimals)
{
	var temp = number*Math.pow(10, decimals);
	return Math.round(temp)/Math.pow(10, decimals);
}


function aoe80(weapon)
{
	var aoe = weapon.area_effect;
	var damage = getDamage(weapon)
	if(damage * aoe.damage.far >= 80)
		return aoe.area_info.radius;
	if(damage * aoe.damage.near < 80)
		return 0;
	var result = 0;
	if(damage * aoe.damage.far < 80 && damage * aoe.damage.mid > 80)
		result = (80/damage - aoe.damage.mid) * (aoe.distance.far - aoe.distance.mid) / 
		-(aoe.damage.mid - aoe.damage.far) + aoe.distance.mid; 
	else{
		result = (80/damage - aoe.damage.near) * (aoe.distance.mid - aoe.distance.near) / 
		-(aoe.damage.near - aoe.damage.mid) + aoe.distance.near;	
	}
	return round(result,2);
}

function CreateTD(text, tr, width, add, bold)
{
	var td = document.createElement('td');
	var textnode ="";
	if(bold)
		{
			textnode = document.createElement('b');
			textnode.appendChild(document.createTextNode(text));
		}
	else
		textnode = document.createTextNode(text);
	if(width != 0)
		td.setAttribute('width', width);
	td.appendChild(textnode);
	if(add)
		tr.appendChild(td);
	return td;
}

function EntityTR(unitid, vet, j)
{
	var ename = elabel[unitid][j];
	var entity = entities[unitid][vet][j];
	var tr = document.createElement('tr');
	CreateTD(ename, tr, 290,true, true);
	CreateTD("Target size: "+round(entity[0], 2), tr, 110, true);
	CreateTD("Sight: "+round(entity[1], 1), tr, 0, true);
	if(entity[2] > 0)
	{
		CreateTD("Speed: "+round(entity[2],1), tr, 0, true);
		CreateTD("Accel: "+round(entity[3],1), tr, 0, true);
		CreateTD("Rotate: "+round(entity[4],1), tr, 0, true);
	}
	if(entity[5] > 1)
	{
		if(entity[6] > 0)
			CreateTD("Armor: "+round(entity[5],1)+"/"+round(entity[6],1), tr, 0, true);
		else
			CreateTD("Armor: "+round(entity[5],1), tr, 0, true);
	}
	if(entity[7] != 80)
	{
		CreateTD("Health: "+round(entity[7],1), tr, 0, true);
	}
	return tr;
}

function Printvet(html, unitid, vet, printfrom, printuntil)
{
	if(vet == 1 && entities[unitid][1] == null)
		return;
	if(vet == 2 && entities[unitid][2] == null)
		return;
	var squadname = squadinfo[unitid][0];
	if(vet == 0 && printuntil == 0)
		printuntil = data[unitid].length;
	if(vet == 1)
		squadname += " vet 3";
	if(vet == 2)
		squadname += " vet 5";
	if(vet > 0)
		addbr(html);
	var h3 = document.createElement("H3");
	
	addTextLine(h3, squadname);
	html.appendChild(h3);
	for(var j=0;j<entities[unitid][vet].length;j++)
	{
		var table = document.createElement('Table');
		table.appendChild(EntityTR(unitid, vet, j));
		html.appendChild(table);

	}
	if(vet == 0)
		addTextLine(html, "Total pop: "+squadinfo[unitid][5]);
	for(var i=printfrom;i<printuntil;i++)
	{	
		if(data[unitid][i] != null)
		{		
		var newcontent = document.createElement('span');
		newcontent.setAttribute('class', 'weapon');
		var a = document.createElement('a');
		var changewep = "changeweapon("+i+")";
		a.setAttribute('href', "#"+unitid);
		a.setAttribute('onclick', changewep);	
		if(data[unitid][i].hardpoint != -1)
			a.innerHTML = data[unitid][i].hardpoint+": "+label[unitid][i];
		else
			a.innerHTML = label[unitid][i];
		var accord = CreateAccordion(unitid, i, a, "");
		newcontent.appendChild(accord);
		html.appendChild(newcontent);
		}
		
	}		
}

function PrintSquad(unitid)
{
	var html = document.createElement('div');
	Printvet(html, unitid, 0, 0, squadinfo[unitid][3]);
	Printvet(html, unitid, 1, squadinfo[unitid][3], squadinfo[unitid][4]);
	Printvet(html, unitid, 2, squadinfo[unitid][4], data[unitid].length);
	var content = document.getElementById("content");
	content.innerHTML = "";
	content.appendChild(html);
	
}
function addbr(parent)
{
	var br = document.createElement('br');
	parent.appendChild(br);
}

function addTextLine(parent, text)
{

	var t = document.createTextNode(text);
	parent.appendChild(t);
	addbr(parent);
}

function accordfunction(acc)
{
    acc.classList.toggle("active");
    var panel = acc.nextElementSibling;
    if (panel.style.maxHeight){
      panel.style.maxHeight = null;
    } else {
      panel.style.maxHeight = panel.scrollHeight + "px";
    } 
}

function dtgenerator(parent, title, value)
{
var dt = document.createElement("DT");
dt.innerHTML = title;
var dd = document.createElement("DD");
dd.innerHTML = value;
parent.appendChild(dt);
parent.appendChild(dd);
}

function dtgeneratorminmax(parent, title, minmax, multiplier, range, weapon)
{
if(minmax.min == minmax.max)
	dtgenerator(parent, title, round(minmax.min * Rangemodifier(range, multiplier, weapon.range),2));
else if(minmax.min != minmax.max)
	dtgenerator(parent, title, round(minmax.min * Rangemodifier(range, multiplier, weapon.range),2)+" - "+round(Rangemodifier(range, multiplier, weapon.range) * minmax.max,2));
}

function base(panel, weapon, label, callback, ability)
{
var bdiv = document.createElement("DIV");
if(!ability)
	bdiv.className = "statdiv";
else
	bdiv.className = "astatdiv";
var h3 = document.createElement("H3");
h3.innerHTML = label;
bdiv.appendChild(h3);
var dl = document.createElement("DL");
callback(dl, weapon);
bdiv.appendChild(dl);
panel.appendChild(bdiv);
}

function statgenerator(panel, unitid, weaponid)
{
	var weapon = data[unitid][weaponid];
	weapon.range = FillRangetable(weapon.range);
	base(panel, weapon, "Basic", basicgenerator);
	base(panel,weapon,"Delays", delaygenerator);
	if(weapon.area_effect.area_info.radius > 0)
		base(panel, weapon, "AOE", aoegenerator);
	base(panel, weapon, "Reload", reloadgenerator);
	if(weapon.burst.can_burst)
		base(panel, weapon, "Burst", burstgenerator);
	if(!weapon.moving.disable_moving_firing)
		base(panel,weapon,"Moving", movinggenerator);
	if(weapon.hasprojectile)
		base(panel, weapon, "Scatter", scattergenerator);
		
	base(panel, weapon, "Tracking", trackinggenerator);
	base(panel, weapon, "Cover Table", covergenerator);
	if(weapon.suppression.amount > 0)
	{
		base(panel, weapon, "Suppression", suppressiongenerator);
	}
	if(weapon.target_type_table.length > 0 && weapon.target_type_table[0].weapon_multipliers.suppression_multiplier == 1)
		base(panel, weapon, "Target Table", targetgenerator);
		/* TODO: Disabled for now, need to fix the ability check on the parser side because it's misplacing counterbarrages
	if(weapon.abilities != null){
		base(panel, weapon, "Abilities", abilitygenerator, true);
	}
	*/
	
}

function basicgenerator(dl, weapon)
{
dtgenerator(dl, "Damage", weapon.damage.min);
dtgenerator(dl, "Accuracy near", weapon.accuracy.near);
dtgenerator(dl, "Accuracy mid", weapon.accuracy.mid);
dtgenerator(dl, "Accuracy far", weapon.accuracy.far);
dtgenerator(dl, "Range near", weapon.range.distance.near);
dtgenerator(dl, "Range mid", weapon.range.distance.mid);
dtgenerator(dl, "Range far", weapon.range.distance.far);
dtgenerator(dl, "Range", weapon.range.min+" - "+weapon.range.max);
dtgenerator(dl, "Penetration near", weapon.penetration.near);
dtgenerator(dl, "Penetration mid", weapon.penetration.mid);
dtgenerator(dl, "Penetration far", weapon.penetration.far);
if(weapon.deflection.has_deflection_damage && weapon.deflection.deflection_damage_multiplier > 0)
	{
		dtgenerator(dl, "Deflection damage", weapon.damage.min * weapon.deflection.deflection_damage_multiplier)
	}
}

function burstgenerator(dl, weapon)
{
dtgeneratorminmax(dl, "Rate of fire near",weapon.burst.rate_of_fire, weapon.burst.rate_of_fire_multiplier, weapon.range.distance.near, weapon);
dtgeneratorminmax(dl, "Rate of fire mid",weapon.burst.rate_of_fire, weapon.burst.rate_of_fire_multiplier, weapon.range.distance.mid, weapon);
dtgeneratorminmax(dl, "Rate of fire far",weapon.burst.rate_of_fire, weapon.burst.rate_of_fire_multiplier, weapon.range.distance.far, weapon);
dtgeneratorminmax(dl, "Burst duration near", weapon.burst.duration, weapon.burst.duration_multiplier, weapon.range.distance.near, weapon) ;
dtgeneratorminmax(dl, "Burst duration mid", weapon.burst.duration, weapon.burst.duration_multiplier, weapon.range.distance.mid, weapon) ;
dtgeneratorminmax(dl, "Burst duration far", weapon.burst.duration, weapon.burst.duration_multiplier, weapon.range.distance.far, weapon) ;
dtgenerator(dl, "Focus fire", weapon.burst.focus_fire);
if(weapon.burst.incremental_target_table.accuracy_multiplier > 1)
{
	dtgenerator(dl, "Incremental Accuracy", "*"+weapon.burst.incremental_target_table.accuracy_multiplier);
	//dtgenerator(dl, "Radius n/m/f", weapon.burst.incremental_target_table.search_radius.near+" / "+weapon.burst.incremental_target_table.search_radius.mid+" / "+weapon.burst.incremental_target_table.search_radius.far);
}
}

function scattergenerator(dl, weapon)
{
dtgenerator(dl, "Scatter angle",weapon.scatter.angle_scatter);
dtgenerator(dl, "Distance offset", weapon.scatter.distance_scatter_offset);
dtgenerator(dl, "Distance ratio", weapon.scatter.distance_scatter_ratio);
dtgenerator(dl, "Distance max", weapon.scatter.distance_scatter_max);

}

function aoegenerator(dl, weapon)
{
dtgenerator(dl, "AOE Radius", weapon.area_effect.area_info.radius);
dtgenerator(dl, "Distance near", weapon.area_effect.distance.near);
dtgenerator(dl, "Distance mid", weapon.area_effect.distance.mid);
dtgenerator(dl, "Distance far", weapon.area_effect.distance.far);
dtgenerator(dl, "Damage near", Math.round(weapon.area_effect.damage.near * weapon.damage.min, 2));
dtgenerator(dl, "Damage mid", Math.round(weapon.area_effect.damage.mid * weapon.damage.min, 2));
dtgenerator(dl, "Damage far", Math.round(weapon.area_effect.damage.far * weapon.damage.min, 2));
dtgenerator(dl, "80 DMG distance", aoe80(weapon));
dtgenerator(dl, "Damage all in hold", weapon.area_effect.damage_all_in_hold);
if(weapon.area_effect.has_friendly_fire){
	dtgenerator(dl, "Damage friendly near", Math.round(weapon.area_effect.damage_friendly.near * weapon.damage.min, 2));
	dtgenerator(dl, "Damage friendly far", Math.round(weapon.area_effect.damage_friendly.far * weapon.damage.min, 2));
}
}

function delaygenerator(dl, weapon)
{
dtgeneratorminmax(dl, "Ready aim time near",weapon.aim.ready_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.near, weapon);
dtgeneratorminmax(dl, "Ready aim time mid",weapon.aim.ready_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.mid, weapon);
dtgeneratorminmax(dl, "Ready aim time far",weapon.aim.ready_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.far, weapon);
dtgeneratorminmax(dl, "Fire aim time near",weapon.aim.fire_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.near, weapon);
dtgeneratorminmax(dl, "Fire aim time mid",weapon.aim.fire_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.mid, weapon);
dtgeneratorminmax(dl, "Fire aim time far",weapon.aim.fire_aim_time, weapon.aim.aim_time_multiplier, weapon.range.distance.far, weapon);
dtgeneratorminmax(dl, "Cooldown time near",weapon.cooldown.duration, weapon.cooldown.duration_multiplier, weapon.range.distance.near, weapon);
dtgeneratorminmax(dl, "Cooldown time mid",weapon.cooldown.duration, weapon.cooldown.duration_multiplier, weapon.range.distance.mid, weapon);
dtgeneratorminmax(dl, "Cooldown time far",weapon.cooldown.duration, weapon.cooldown.duration_multiplier, weapon.range.distance.far, weapon);
dtgenerator(dl, "Wind up", weapon.fire.wind_up);
dtgenerator(dl, "Wind down", weapon.fire.wind_down);

}

function movinggenerator(dl, weapon)
{
dtgenerator(dl, "Accuracy multi", weapon.moving.accuracy_multiplier);
dtgenerator(dl, "Burst duration multi", weapon.moving.burst_multiplier);
dtgenerator(dl, "Cooldown duration multi", weapon.moving.cooldown_multiplier);

}

function trackinggenerator(dl, weapon)
{
dtgenerator(dl, "Horizontal speed", weapon.tracking.normal.speed_horizontal);
dtgenerator(dl, "Left/Right Rotation", weapon.tracking.normal.max_left+" to "+weapon.tracking.normal.max_right);
dtgenerator(dl, "Fire cone angle", weapon.tracking.fire_cone_angle);

}

function suppressiongenerator(dl, weapon)
{
	if(weapon.target_type_table.length > 0 && weapon.target_type_table[0].weapon_multipliers.suppression_multiplier != 1)
	{
	dtgenerator(dl, "Amount", round(weapon.suppression.amount*weapon.target_type_table[0].weapon_multipliers.suppression_multiplier,5));
	dtgenerator(dl, "AOE suppression", round(weapon.suppression.amount*weapon.suppression.nearby_suppression_multiplier*weapon.target_type_table[0].weapon_multipliers.suppression_multiplier,5));
	}
	else
	{
		dtgenerator(dl, "Amount", round(weapon.suppression.amount,5));
		dtgenerator(dl, "AOE suppression", round(weapon.suppression.amount*weapon.suppression.nearby_suppression_multiplier,5));
	}
dtgenerator(dl, "AOE suppression radius", weapon.suppression.nearby_suppression_radius);

}


function abilitygenerator(dl,weapon)
{
dtgenerator(dl, weapon.abilities, "");
}

function reloadgenerator(dl, weapon)
{
dtgeneratorminmax(dl, "Reload duration", weapon.reload.duration, weapon.reload.duration_multiplier, weapon.range.distance.near, weapon);
dtgenerator(dl, "Reload frequency min", weapon.reload.frequency.min+1);
dtgenerator(dl, "Reload frequency max", weapon.reload.frequency.max+1);
}

function covergenerator(dl, weapon)
{
if(weapon.cover_table[cover_table_keys[currentcover]].accuracy_multiplier != 1)
	dtgenerator(dl, "Default accuracy", weapon.cover_table.tp_defcover.accuracy_multiplier);
if(weapon.cover_table[cover_table_keys[currentcover]].damage_multiplier != 1)
	dtgenerator(dl, "Default damage", weapon.cover_table.tp_defcover.damage_multiplier);
dtgenerator(dl, "Light cover accuracy", weapon.cover_table.tp_light.accuracy_multiplier);
dtgenerator(dl, "Light cover damage", weapon.cover_table.tp_light.damage_multiplier);
dtgenerator(dl, "Heavy cover accuracy", weapon.cover_table.tp_heavy.accuracy_multiplier);
dtgenerator(dl, "Heavy cover damage", weapon.cover_table.tp_heavy.damage_multiplier);
dtgenerator(dl, "Garrison accuracy", weapon.cover_table.tp_garrison_cover.accuracy_multiplier);
dtgenerator(dl, "Garrison damage", weapon.cover_table.tp_garrison_cover.damage_multiplier);
dtgenerator(dl, "Negative accuracy", weapon.cover_table.tp_negative.accuracy_multiplier);
dtgenerator(dl, "Negative damage", weapon.cover_table.tp_negative.damage_multiplier);
}

function targetgenerator(dl, weapon)
{
for(var i=0;i<weapon.target_type_table.length;i++)
{
	if(weapon.target_type_table[i].weapon_multipliers.suppression_multiplier == 1)
	{
		dtgenerator(dl, "Target type", weapon.target_type_table[i].unit_type);
		dtgenerator(dl, "Accuracy multi", weapon.target_type_table[i].weapon_multipliers.accuracy_multiplier);
		dtgenerator(dl, "Damage multi", weapon.target_type_table[i].weapon_multipliers.damage_multiplier);
		if(i <weapon.target_type_table.length -1 || weapon.damage.effects != null)
			dtgenerator(dl,"-----","-----");
	}
	if(weapon.damage.effects != null)
	{
		for(var i2 = 0;i2<weapon.damage.effects.length;i2++) //Everything is called "i2" here because it causes an infinite loop
		{
			if(weapon.damage.effects[i2] != null && weapon.damage.effects[i2].damage > 0)
			{
				dtgenerator(dl,"Extra damage",weapon.damage.effects[i2].damage+", "+weapon.damage.effects[i2].requirement);
				if(i2 < weapon.damage.effects.length-1)
					dtgenerator(dl,"-----","");
			}			
		}
	}
}
}