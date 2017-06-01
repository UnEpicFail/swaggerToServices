const mustache = require('mustache');
const js_yaml = require('js-yaml');
const fs = require('fs');

var FilesStorage = {};

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function typeToType(type, data) {
    if(type.indexOf('[]') > -1){
        return type;
    }
    switch (type){
        case 'number':
        case 'integer':
        case 'long':
        case 'float':
        case 'double':
            return 'number';
        case 'bolean':
            return 'bolean';
        case 'array':
            return typeToType(data.items.type, data.items)+'[]';
        case 'object':
            return '{}';
        default:
            return 'string';
    }
}

var Parameters = function (parameters, that) {
    this.that = that;
    this.parameters = parameters;
    this.sortedParameters = {};
    this.sortParameters();
}

Parameters.prototype.sortParameters = function() {
    for (var i in this.parameters){
        if (this.parameters[i]['$ref']) {
            this.getParamsFromRef(this.parameters[i]['$ref'])
        } else {
            if (!this.sortedParameters[this.parameters[i].in])
                this.sortedParameters[this.parameters[i].in] = {}
            this.sortedParameters[this.parameters[i].in][this.parameters[i].required] = this.parameters[i]
            if (this.sortedParameters[this.parameters[i].in][this.parameters[i].required].schema){
                this.sortedParameters[this.parameters[i].in][this.parameters[i].required].type = this.getTypeOfItems(this.sortedParameters[this.parameters[i].in][this.parameters[i].required].schema)
                if (this.sortedParameters[this.parameters[i].in][this.parameters[i].required].schema.type === 'array') {
                    this.sortedParameters[this.parameters[i].in][this.parameters[i].required].type += '[]';
                }
            } else {
                this.sortedParameters[this.parameters[i].in][this.parameters[i].required].type = typeToType(this.sortedParameters[this.parameters[i].in][this.parameters[i].required].type, this.sortedParameters[this.parameters[i].in][this.parameters[i].required])
            }
        }
    }
}

Parameters.prototype.getTypeOfItems = function(schema) {
    let items = (schema.items || schema)
    
    if (typeof items['$ref'] !== 'undefined') {
        let data = {}
        let parsedRef = items['$ref'].split('#')
        let fileName = (parsedRef[0] || this.that.fileName).split('.')[0]
        let parsedPlace = parsedRef[1].split('/')
        let name = parsedPlace[2]
        
        if (typeof this.that.imports[fileName] === 'undefined') {
            this.that.imports[fileName] = {};
        }
        this.that.imports[fileName][parsedPlace[2]] = name
        return name
    } else {
        return typeToType(items.type, items);
    }
}

Parameters.prototype.getParamsFromRef = function(ref){
    let data = {}
    let parsedRef = ref.split('#')
    let fileName = parsedRef[0]
    let parsedPlace = parsedRef[1].split('/')
    let place = parsedPlace[1]
    let name = parsedPlace[2]
    if (fileName) {
        let json = {};
        if(typeof FilesStorage[fileName] === 'undefined') {
            let file = fs.readFileSync(this.that.dir+'/'+fileName, 'utf8');
            if (!file){
                console.error('Error: Readed file ' + fileName + 'not valid');
                return;
            }

            try {
                json = js_yaml.safeLoad(file);
                FilesStorage[fileName] = json; 
            } catch (e) {
                console.error('Error: e', e);
            }
        } else {
            json = FilesStorage[fileName]
        }
        data = json[place][name]
    } else {
        data = this.that.json[place][name]
    }
    if (!this.sortedParameters[data.in])
        this.sortedParameters[data.in] = {} 
    
    if (!this.sortedParameters[data.in][data.required])
        this.sortedParameters[data.in][data.required] = []

    data.type = typeToType(data.type, data)
    this.sortedParameters[data.in][data.required].push(data) 

}

var ParsedData = function (json, dir, fileName) {
    this.dir = dir;
    this.fileName = fileName;
    this.serviceName = capitalizeFirstLetter(fileName)+'Service';
    this.json = json;
    this.paths = {};
    this.imports = {};

    for (let i in json.paths) {
        this.addPath(json.paths[i], i);
    }

    this.makeFlatPaths()
    this.makeFlatImports()
}

ParsedData.prototype.makeFlatImports = function() {
    this.flatImports = [];
    for (let i in this.imports) {
        let data = {
            from: i,
            imports: []
        }
        for (let j in this.imports[i]){
            data.imports.push(j)
        }
        this.flatImports.push(data)
    }
}

ParsedData.prototype.addPath = function(path, url) {
    for(let i in path){
        if (!this.paths[path[i].operationId]){
            this.paths[path[i].operationId] = {}
        }
        this.paths[path[i].operationId][i] = {
            url: url,
            type: i,
            description: path[i].description,
            tags: path[i].tags,
            parameters: new Parameters(path[i].parameters, this)
        }
    }
}

ParsedData.prototype.makeFlatPaths = function() {
    this.flatPaths = []
    let data = {}
    for (let i in this.paths) {
        data = {}
        for (let j in this.paths[i]){
            data = {
                name: i,
                data: this.paths[i][j]
            }
        }
        this.flatPaths.push(data)
    }
}


function parse(json, output, fileName, dir) {
    let info = json.info;
    let schemes = json.schemes;
    let basePath = json.basePath;
    let produces = json.produces;
    let paths = json.paths;
    if (!schemes || !basePath || !produces || !paths) {
        console.error('Error: not enough data:');
        if (!schemes) {
            console.error('- schemes is not valid', schemes);
        }
        if (!basePath) {
            console.error('- basePath is not valid', basePath);
        }
        if (!produces) {
            console.error('- produces is not valid', produces);
        }
        if (!paths) {
            console.error('- paths is not valid', paths);
        } 
        return false;
    }

    let data = new ParsedData(json, dir, fileName);
    data.basePath = basePath;
    let installedfolder = __dirname.split('/')
    installedfolder.pop()
    let tpl = fs.readFileSync(installedfolder.join('/')+'/tpl/service.mustache', 'utf8');

    fs.writeFile(output +'/'+fileName+'.ts', mustache.render(tpl, data), { flag: 'w' }, function(res){
        console.log('File write '+output +'/'+fileName+'.ts');
    })

}

module.exports.parse = parse